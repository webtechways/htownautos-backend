import { SetMetadata } from '@nestjs/common';

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * For a route that is ALSO marked @Public(): ClerkJwtGuard normally skips
 * all token handling for @Public() routes (no request.user, ever). Adding
 * @OptionalAuth() makes it best-effort try to resolve a Clerk token if one
 * is present (so a logged-in caller gets `request.user` — e.g. to see
 * unmasked price data on stats.htownautos.com) while still never throwing
 * on a missing/invalid/expired token — the route stays reachable
 * anonymously either way.
 *
 * No effect without @Public() — a non-public route already requires auth.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
