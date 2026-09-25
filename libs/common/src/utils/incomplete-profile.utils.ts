/**
 * Placeholder values a Clerk web sign-up webhook writes onto a stub `Buyer`
 * row when the customer hasn't supplied real DOB/address/phone yet (see
 * docs/identity/CLERK-SYNC-DESIGN.md, package B3 —
 * `apps/data-sync/src/identity/clerk-events.consumer.ts` `createWebSignupBuyer`).
 * Every staff- or portal-facing mapper that reads these fields must mask them
 * back to `null` instead of showing fake data. Kept here (not in the
 * consumer) so the writer and every reader share one definition.
 */
export const PENDING_PHONE_PREFIX = 'pending-';
export const PLACEHOLDER_DATE_OF_BIRTH_ISO = '1900-01-01';

export function isPendingPlaceholderPhone(phone: string | null | undefined): boolean {
  return !!phone && phone.startsWith(PENDING_PHONE_PREFIX);
}

export function isPlaceholderDateOfBirth(dob: Date | string | null | undefined): boolean {
  if (!dob) return false;
  const iso = typeof dob === 'string' ? dob : dob.toISOString();
  return iso.startsWith(PLACEHOLDER_DATE_OF_BIRTH_ISO);
}

/** `currentAddress`/`currentCity`/`currentState`/`currentZipCode` are required, non-nullable
 * columns — an empty string can only come from this web-signup stub path, never a real DTO
 * submission (all validated with `@IsNotEmpty`). */
export function isPlaceholderAddressField(value: string | null | undefined): boolean {
  return value === '';
}

/**
 * Synthetic login email Clerk's `user.created` webhook handler mints for a
 * phone-only (SMS code) sign-up, since `User.email` is `NOT NULL @unique` and
 * Clerk gives us no real address in that case. Must never be pushed back to
 * Clerk as a real email (see `identity-clerk-push.consumer.ts`) nor shown in
 * any UI.
 */
export const SYNTHETIC_CLERK_EMAIL_DOMAIN = 'clerk.no-email.htownautos.internal';

export function isSyntheticClerkEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${SYNTHETIC_CLERK_EMAIL_DOMAIN}`);
}
