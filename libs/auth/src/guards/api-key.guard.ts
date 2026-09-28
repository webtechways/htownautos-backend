import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '@htownautos/prisma';
import * as crypto from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { API_SCOPES_KEY } from '../decorators/api-scopes.decorator';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { hasScope } from '../constants/api-scopes';

/**
 * Accepts an API key via `X-API-Key` header OR `Authorization: Bearer hta_…`.
 *
 * Behavior:
 *  - No API key present → no-op (lets ClerkJwtGuard handle it).
 *  - API key present but invalid → 401.
 *  - API key valid:
 *      • synthesizes `request.user` with `{ id: 'api-key:<keyId>', ... }`
 *      • resolves `request.tenant` from the key's tenantId (so TenantGuard short-circuits)
 *      • enforces `@RequireApiScopes(...)` metadata on the route (403 if missing)
 *      • updates `lastUsedAt` / `lastUsedIp` (best-effort, non-blocking)
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  static readonly KEY_PREFIX = 'hta_';

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const rawKey = this.extractKey(request);

    // @Public() routes ignore API keys — except @Public() + @OptionalAuth(),
    // where a key that IS sent is validated (and its scopes enforced) so a
    // server-to-server caller gets the same unmasked data a signed-in user
    // does. Anonymous callers on those routes are unaffected.
    if (isPublic) {
      const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!isOptionalAuth || !rawKey) return true;
    }

    // No API key → not our job. ClerkJwtGuard will authenticate.
    if (!rawKey) return true;

    const hashedKey = this.hash(rawKey);
    const key = await this.prisma.apiKey.findUnique({
      where: { hashedKey },
      include: { tenant: true },
    });

    if (!key) throw new UnauthorizedException('Invalid API key');
    if (key.revokedAt) throw new UnauthorizedException('API key revoked');
    if (key.expiresAt && key.expiresAt < new Date()) {
      throw new UnauthorizedException('API key expired');
    }
    if (!key.tenant || !key.tenant.isActive) {
      throw new UnauthorizedException('Tenant inactive');
    }

    // Enforce scopes declared by @RequireApiScopes on the route
    const requiredScopes =
      this.reflector.getAllAndOverride<string[]>(API_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) || [];

    for (const required of requiredScopes) {
      if (!hasScope(key.scopes, required)) {
        throw new ForbiddenException(
          `API key is missing required scope: ${required}`,
        );
      }
    }

    // Stamp the request so downstream guards short-circuit
    request.apiKey = { id: key.id, prefix: key.prefix, scopes: key.scopes };
    request.tenant = key.tenant;
    request.user = {
      id: `api-key:${key.id}`,
      clerkUserId: null,
      email: `api-key+${key.prefix}@${key.tenant.slug}.internal`,
      name: key.name,
      firstName: null,
      lastName: null,
      phoneNumber: null,
      avatar: null,
      isActive: true,
      emailVerified: true,
      tenants: [
        {
          id: key.id,
          tenantId: key.tenantId,
          roleId: '',
          isActive: true,
          tenant: {
            id: key.tenant.id,
            name: key.tenant.name,
            slug: key.tenant.slug,
          },
        },
      ],
    };

    // Fire-and-forget usage stamp
    this.prisma.apiKey
      .update({
        where: { id: key.id },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: this.getClientIp(request),
        },
      })
      .catch((err) => this.logger.warn(`Failed to stamp API key usage: ${err.message}`));

    return true;
  }

  private extractKey(request: any): string | null {
    const headerKey = request.headers['x-api-key'];
    if (typeof headerKey === 'string' && headerKey.startsWith(ApiKeyGuard.KEY_PREFIX)) {
      return headerKey;
    }
    const auth = request.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const token = auth.substring(7);
      if (token.startsWith(ApiKeyGuard.KEY_PREFIX)) return token;
    }
    return null;
  }

  private hash(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  private getClientIp(request: any): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
    return request.headers['x-real-ip'] || request.ip || 'unknown';
  }
}
