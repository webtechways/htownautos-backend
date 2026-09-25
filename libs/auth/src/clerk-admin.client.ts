import { createClerkClient } from '@clerk/backend';

/**
 * Plain factory for the Clerk backend admin client — deliberately NOT a Nest
 * injectable. `data-sync` must not import `AuthModule` (it registers the
 * global `APP_GUARD` chain meant for the api's HTTP pipeline; wiring it into
 * a worker app would pull in Clerk JWT / tenant guards it has no use for).
 *
 * Mirrors the pattern already used by `CustomerGuard`
 * (`libs/auth/src/guards/customer.guard.ts`): instantiate directly, once, at
 * module scope in the consumer that needs it.
 */
export function createClerkAdminClient() {
  return createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
}

export type ClerkAdminClient = ReturnType<typeof createClerkAdminClient>;
