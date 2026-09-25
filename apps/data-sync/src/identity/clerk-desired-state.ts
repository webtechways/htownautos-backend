import { createHash } from 'crypto';

/**
 * Shape of the CRM's desired Clerk-side state for a `User`. Shared between
 * `IdentityClerkPushConsumer` (B2, builds it from fresh DB state before
 * writing to Clerk) and `ClerkEventsConsumer` (B3, builds it from an incoming
 * webhook to detect whether the event is just an echo of our own last push —
 * both MUST hash identically or the loop guard breaks). See
 * docs/identity/CLERK-SYNC-DESIGN.md.
 */
export interface DesiredClerkState {
  email: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  externalId: string;
  publicMetadata: { userType: string; customerTenantIds: string[]; crmUserId: string };
}

export function hashDesiredState(state: DesiredClerkState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
