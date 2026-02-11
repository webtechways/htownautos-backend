import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../prisma.service';

export interface CognitoPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  'cognito:username'?: string;
  username?: string;
  token_use: string;
  auth_time: number;
  iss: string;
  exp: number;
  iat: number;
  client_id?: string;
  scope?: string;
}

export interface IdTokenPayload {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  'cognito:username'?: string;
  identities?: Array<{
    providerName: string;
    providerType: string;
  }>;
}

export interface AuthenticatedUser {
  id: string;
  cognitoSub: string;
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
export class CognitoJwtGuard implements CanActivate {
  private readonly logger = new Logger(CognitoJwtGuard.name);
  private verifier: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      tokenUse: 'access',
      clientId: process.env.COGNITO_CLIENT_ID!,
    });
  }

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

    const accessToken = this.extractToken(request);

    if (!accessToken) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // Verify access token with Cognito
      const accessPayload = await this.verifier.verify(accessToken);

      // Extract email from ID token (X-Id-Token header)
      const idTokenPayload = this.extractIdTokenPayload(request);

      // Get or create user
      const user = await this.getOrCreateUser(
        accessPayload as CognitoPayload,
        idTokenPayload,
        request,
      );

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
    return request.cookies?.cognito_access_token || null;
  }

  private extractIdTokenPayload(request: any): IdTokenPayload | null {
    try {
      const idToken = request.headers['x-id-token'];
      if (!idToken) {
        return null;
      }

      const parts = idToken.split('.');
      if (parts.length !== 3) {
        return null;
      }

      return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  private async getOrCreateUser(
    accessPayload: CognitoPayload,
    idTokenPayload: IdTokenPayload | null,
    request: any,
  ): Promise<AuthenticatedUser> {
    const startTime = Date.now();
    const cognitoSub = accessPayload.sub;
    const email = idTokenPayload?.email || '';

    // Try to find existing user by cognitoSub first
    let user = await this.prisma.user.findUnique({
      where: { cognitoSub },
      include: {
        tenants: {
          where: { isActive: true, status: 'active' },
          include: {
            tenant: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    // If not found by cognitoSub, try to find by email (for invited users)
    if (!user && email) {
      const existingUserByEmail = await this.prisma.user.findUnique({
        where: { email },
        include: {
          tenants: {
            where: { isActive: true },
            include: {
              tenant: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });

      // If user exists by email but has no cognitoSub, link them to this Cognito account
      if (existingUserByEmail) {
        const name = idTokenPayload?.name || null;
        const firstName = idTokenPayload?.given_name || existingUserByEmail.firstName;
        const lastName = idTokenPayload?.family_name || existingUserByEmail.lastName;
        const avatar = idTokenPayload?.picture || existingUserByEmail.avatar;
        const emailVerified = idTokenPayload?.email_verified ?? existingUserByEmail.emailVerified;

        this.logger.log('========================================');
        this.logger.log('LINKING EXISTING USER TO COGNITO');
        this.logger.log('========================================');
        this.logger.log(`Email: ${email}`);
        this.logger.log(`Cognito Sub: ${cognitoSub}`);
        this.logger.log(`Existing User ID: ${existingUserByEmail.id}`);
        this.logger.log(`Previous Cognito Sub: ${existingUserByEmail.cognitoSub || 'None'}`);

        // Update the existing user with the Cognito sub and any new profile info
        user = await this.prisma.user.update({
          where: { id: existingUserByEmail.id },
          data: {
            cognitoSub,
            name: name || existingUserByEmail.name,
            firstName,
            lastName,
            avatar,
            emailVerified,
            isActive: true, // Activate user when they complete Cognito login
          },
          include: {
            tenants: {
              where: { isActive: true },
              include: {
                tenant: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                  },
                },
              },
            },
          },
        });

        this.logger.log(`User linked successfully to Cognito`);
        this.logger.log('========================================');

        // Save auth event to database
        const duration = Date.now() - startTime;
        await this.createAuthAuditLog({
          userId: user.id,
          userEmail: email,
          cognitoSub,
          action: 'user-linked',
          status: 'success',
          ipAddress: this.getClientIp(request),
          userAgent: request.headers['user-agent'] || 'unknown',
          duration,
          metadata: {
            previousCognitoSub: existingUserByEmail.cognitoSub,
            name,
            firstName,
            lastName,
            emailVerified,
          },
        });
      }
    }

    // If user still doesn't exist, create them
    if (!user) {
      const name = idTokenPayload?.name || null;
      const firstName = idTokenPayload?.given_name || null;
      const lastName = idTokenPayload?.family_name || null;
      const avatar = idTokenPayload?.picture || null;
      const emailVerified = idTokenPayload?.email_verified ?? false;

      if (!email) {
        this.logger.error('Cannot create user: no email provided in ID token');
        throw new UnauthorizedException('Email required for user creation. Make sure X-Id-Token header is provided.');
      }

      this.logger.log('========================================');
      this.logger.log('NEW USER REGISTRATION (Auto-provisioning)');
      this.logger.log('========================================');
      this.logger.log(`Email: ${email}`);
      this.logger.log(`Cognito Sub: ${cognitoSub}`);
      this.logger.log(`Name: ${name || 'Not provided'}`);
      this.logger.log(`First Name: ${firstName || 'Not provided'}`);
      this.logger.log(`Last Name: ${lastName || 'Not provided'}`);
      this.logger.log(`Avatar: ${avatar ? 'Provided' : 'Not provided'}`);
      this.logger.log(`Email Verified: ${emailVerified}`);

      user = await this.prisma.user.create({
        data: {
          cognitoSub,
          email,
          name,
          firstName,
          lastName,
          avatar,
          emailVerified,
          isActive: true,
        },
        include: {
          tenants: {
            where: { isActive: true },
            include: {
              tenant: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
            },
          },
        },
      });

      this.logger.log(`User created successfully with ID: ${user.id}`);
      this.logger.log('========================================');

      // Save auth event to database
      const duration = Date.now() - startTime;
      await this.createAuthAuditLog({
        userId: user.id,
        userEmail: email,
        cognitoSub,
        action: 'user-created',
        status: 'success',
        ipAddress: this.getClientIp(request),
        userAgent: request.headers['user-agent'] || 'unknown',
        duration,
        metadata: {
          name,
          firstName,
          lastName,
          emailVerified,
        },
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

    return {
      id: user.id,
      cognitoSub: user.cognitoSub!, // Non-null assertion: authenticated users must have cognitoSub
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

  private getClientIp(request: any): string {
    // Check for forwarded IP (when behind proxy/load balancer)
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      // x-forwarded-for can contain multiple IPs, the first one is the client
      const ips = forwarded.split(',').map((ip: string) => ip.trim());
      return ips[0] || 'unknown';
    }

    // Check for real IP header (nginx)
    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return realIp;
    }

    // Fall back to connection remote address
    return request.ip || request.connection?.remoteAddress || 'unknown';
  }

  private async createAuthAuditLog(data: {
    userId: string;
    userEmail: string;
    cognitoSub: string;
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
            cognitoSub: data.cognitoSub,
            ...data.metadata,
          },
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create auth audit log: ${error.message}`);
    }
  }
}
