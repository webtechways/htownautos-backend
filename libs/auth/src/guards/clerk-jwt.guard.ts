import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyToken, createClerkClient } from '@clerk/backend';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '@htownautos/prisma';

// Instantiated directly (not injected via DI): dozens of controllers apply
// `@UseGuards(ClerkJwtGuard)` at the class level even though it also runs
// globally (legacy from before the guard became global — harmless, but it
// means Nest creates a scoped instance of this guard in EVERY one of those
// modules). Adding a new constructor dependency here would require wiring
// ClerkService into every one of those modules too, or the API crash-loops
// on boot with "Nest can't resolve dependencies". See CustomerGuard for the
// same pattern.
const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

export interface ClerkTokenPayload {
  sub: string;
  org_id?: string;
  org_role?: string;
  org_slug?: string;
  email?: string;
  email_verified?: boolean;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  image_url?: string;
}

export interface AuthenticatedUser {
  id: string;
  clerkUserId: string;
  email: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
  avatar: string | null;
  isActive: boolean;
  emailVerified: boolean;
  tenants: Array<{
    id: string;
    tenantId: string;
    roleId: string;
    isActive: boolean;
    tenant: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
}

@Injectable()
export class ClerkJwtGuard implements CanActivate {
  private readonly logger = new Logger(ClerkJwtGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // If ApiKeyGuard already authenticated the request, don't re-auth via Clerk.
    if (request.apiKey && request.user) {
      return true;
    }

    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // Verify token with Clerk
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });

      const clerkUserId = payload.sub;

      // Get user metadata from X-Clerk-User header (set by frontend)
      const userMeta = this.extractUserMeta(request);

      // Get or create user
      const user = await this.getOrCreateUser(clerkUserId, userMeta, request);

      // Extract Clerk Organization claims from JWT
      // Clerk uses both formats: top-level org_id or compact 'o' object
      request.clerkOrgId = (payload as any).org_id || (payload as any).o?.id || null;
      request.clerkOrgRole = (payload as any).org_role || ((payload as any).o?.rol ? `org:${(payload as any).o.rol}` : null);

      // Attach user to request
      request.user = user;
      request.session = { user };
      return true;
    } catch (error) {
      this.logger.error('Token verification failed:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: any): string | null {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }

  private extractUserMeta(request: any): Partial<ClerkTokenPayload> | null {
    try {
      const meta = request.headers['x-clerk-user'];
      if (!meta) return null;
      return JSON.parse(Buffer.from(meta, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  private async getOrCreateUser(
    clerkUserId: string,
    userMeta: Partial<ClerkTokenPayload> | null,
    request: any,
  ): Promise<AuthenticatedUser> {
    const startTime = Date.now();

    const tenantInclude = {
      tenants: {
        where: { isActive: true, status: 'active' },
        include: {
          tenant: {
            select: { id: true, name: true, slug: true },
          },
        },
      },
    };

    // Fast path: user already linked by the verified JWT `sub`. No Clerk
    // API call needed — this is the hot path for every authenticated request.
    let user = await this.prisma.user.findUnique({
      where: { clerkUserId },
      include: tenantInclude,
    });

    if (!user) {
      // Slow path: unknown clerkUserId. The ONLY trusted source of identity
      // beyond the JWT `sub` is Clerk itself — never the client-sent
      // X-Clerk-User header, which is unsigned and attacker-controlled.
      const identity = await this.getVerifiedIdentity(clerkUserId);
      const email = identity?.email;

      if (!email) {
        throw new UnauthorizedException('No verified email associated with this Clerk account');
      }

      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email },
        include: {
          tenants: {
            where: { isActive: true },
            include: {
              tenant: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      if (existingUserByEmail) {
        const previousClerkUserId = existingUserByEmail.clerkUserId;
        const canLink =
          !previousClerkUserId || (await this.clerkUserIsGone(previousClerkUserId));

        if (!canLink) {
          const duration = Date.now() - startTime;
          await this.createAuthAuditLog({
            userId: existingUserByEmail.id,
            userEmail: email,
            clerkUserId,
            action: 'user-link-refused',
            status: 'blocked',
            ipAddress: this.getClientIp(request),
            userAgent: request.headers['user-agent'] || 'unknown',
            duration,
            metadata: { previousClerkUserId },
          });
          throw new UnauthorizedException('Unable to authenticate this account');
        }

        this.logger.log(`Linking existing user ${email} to Clerk ID ${clerkUserId}`);

        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            clerkUserId,
            firstName: identity?.firstName || existingUserByEmail.firstName,
            lastName: identity?.lastName || existingUserByEmail.lastName,
            avatar: identity?.imageUrl || existingUserByEmail.avatar,
            emailVerified: true,
            isActive: true,
          },
          include: tenantInclude,
        });

        const duration = Date.now() - startTime;
        await this.createAuthAuditLog({
          userId: user.id,
          userEmail: email,
          clerkUserId,
          action: 'user-linked',
          status: 'success',
          ipAddress: this.getClientIp(request),
          userAgent: request.headers['user-agent'] || 'unknown',
          duration,
          metadata: { previousClerkUserId },
        });
      } else {
        // Brand-new user. Display-only fields (name/avatar) may fall back to
        // the unsigned header — it is never used for identity or linking.
        const firstName = identity?.firstName || userMeta?.first_name || null;
        const lastName = identity?.lastName || userMeta?.last_name || null;
        const name = userMeta?.full_name || [firstName, lastName].filter(Boolean).join(' ') || null;
        const avatar = identity?.imageUrl || userMeta?.image_url || null;

        this.logger.log(`Auto-provisioning new user: ${email} (Clerk: ${clerkUserId})`);

        user = await this.prisma.user.create({
          data: {
            clerkUserId,
            email,
            name,
            firstName,
            lastName,
            avatar,
            emailVerified: true,
            isActive: true,
          },
          include: tenantInclude,
        });

        const duration = Date.now() - startTime;
        await this.createAuthAuditLog({
          userId: user.id,
          userEmail: email,
          clerkUserId,
          action: 'user-created',
          status: 'success',
          ipAddress: this.getClientIp(request),
          userAgent: request.headers['user-agent'] || 'unknown',
          duration,
          metadata: { name, firstName, lastName },
        });
      }
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

    return {
      id: user.id,
      clerkUserId: user.clerkUserId!,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      phoneNumber: user.phoneNumber,
      avatar: user.avatar,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      tenants: user.tenants.map((t) => ({
        id: t.id,
        tenantId: t.tenantId,
        roleId: t.roleId,
        isActive: t.isActive,
        tenant: t.tenant,
      })),
    };
  }

  /**
   * Fetch a Clerk user's verified primary email directly from Clerk. This is
   * the only trusted source of identity beyond the JWT `sub` — never the
   * client-sent X-Clerk-User header.
   */
  private async getVerifiedIdentity(clerkUserId: string): Promise<{
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    imageUrl: string | null;
  } | null> {
    try {
      const user = await clerkClient.users.getUser(clerkUserId);
      const primary = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId && e.verification?.status === 'verified',
      );
      return {
        email: primary?.emailAddress ?? null,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.imageUrl ?? null,
      };
    } catch (error: any) {
      if (error?.status === 404) return null;
      this.logger.error(`Failed to fetch Clerk user ${clerkUserId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * True only when Clerk confirms clerkUserId does NOT exist (404). Other
   * errors are rethrown so a transient Clerk outage never gets mistaken for
   * "this account is gone" and triggers an unwanted relink.
   */
  private async clerkUserIsGone(clerkUserId: string): Promise<boolean> {
    try {
      await clerkClient.users.getUser(clerkUserId);
      return false;
    } catch (error: any) {
      if (error?.status === 404) return true;
      this.logger.error(`Failed to check Clerk user ${clerkUserId}: ${error.message}`);
      throw error;
    }
  }

  private getClientIp(request: any): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0]?.trim() || 'unknown';
    }
    return request.headers['x-real-ip'] || request.ip || request.connection?.remoteAddress || 'unknown';
  }

  private async createAuthAuditLog(data: {
    userId: string;
    userEmail: string;
    clerkUserId: string;
    action: string;
    status: string;
    ipAddress?: string;
    userAgent?: string;
    duration?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: data.userId,
          userEmail: data.userEmail,
          action: data.action,
          resource: 'auth',
          method: 'POST',
          url: '/auth',
          ipAddress: data.ipAddress || 'unknown',
          userAgent: data.userAgent || 'unknown',
          duration: data.duration,
          status: data.status,
          level: 'critical',
          pii: true,
          compliance: ['glba'],
          metadata: {
            clerkUserId: data.clerkUserId,
            ...data.metadata,
          },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create auth audit log: ${error.message}`);
    }
  }
}
