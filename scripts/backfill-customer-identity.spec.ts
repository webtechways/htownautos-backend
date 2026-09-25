// Importing this module pulls in `@htownautos/auth`'s index, which has a
// module-scope `createClerkClient(...)` side effect in customer.guard.ts —
// mock the whole package so the test doesn't depend on CLERK_SECRET_KEY
// being present in the environment (see [[global-guard-di-crashloop]] /
// identity-sync-b3 memory notes).
jest.mock('@htownautos/auth', () => ({
  createClerkAdminClient: () => ({ users: {}, emailAddresses: {}, phoneNumbers: {} }),
  ensureUserForBuyer: jest.fn(),
  PORTAL_TENANT_ID: 'portal-tenant',
}));

import { decideClerkAction, type DecideClerkActionInput } from './backfill-customer-identity';

function baseInput(overrides: Partial<DecideClerkActionInput> = {}): DecideClerkActionInput {
  return {
    email: 'buyer@example.com',
    portalEnabled: true,
    localUserId: 'user-1',
    localUserClerkId: null,
    clerkMatchId: null,
    clerkMatchOwnerUserId: null,
    ...overrides,
  };
}

describe('decideClerkAction', () => {
  it('skips when the tenant is not customer-portal-enabled', () => {
    expect(decideClerkAction(baseInput({ portalEnabled: false }))).toEqual({
      action: 'skip',
      reason: 'non_portal_tenant',
    });
  });

  it('skips when the buyer has no email', () => {
    expect(decideClerkAction(baseInput({ email: null }))).toEqual({
      action: 'skip',
      reason: 'no_email',
    });
  });

  it('non-portal tenant takes priority over a missing email', () => {
    expect(decideClerkAction(baseInput({ portalEnabled: false, email: null })).action).toBe('skip');
  });

  it('creates when no Clerk account exists for the email/phone', () => {
    expect(decideClerkAction(baseInput({ clerkMatchId: null, localUserClerkId: null }))).toEqual({
      action: 'create',
      reason: 'no_clerk_account_found',
    });
  });

  it('links when a Clerk account exists and nothing else claims it', () => {
    expect(
      decideClerkAction(baseInput({ clerkMatchId: 'clerk_1', clerkMatchOwnerUserId: null, localUserClerkId: null })),
    ).toEqual({ action: 'link', reason: 'clerk_user_found_by_email_or_phone' });
  });

  it('links when the Clerk account is already correctly owned by this same local user', () => {
    expect(
      decideClerkAction(
        baseInput({ clerkMatchId: 'clerk_1', clerkMatchOwnerUserId: 'user-1', localUserClerkId: 'clerk_1' }),
      ),
    ).toEqual({ action: 'link', reason: 'clerk_user_found_by_email_or_phone' });
  });

  it('flags a conflict when the Clerk account is already linked to a different CRM user', () => {
    expect(
      decideClerkAction(
        baseInput({ clerkMatchId: 'clerk_1', clerkMatchOwnerUserId: 'user-OTHER', localUserClerkId: null }),
      ),
    ).toEqual({ action: 'conflict', reason: 'clerk_user_linked_to_another_crm_user' });
  });

  it('flags a conflict (staff mismatch) when the local user is linked to a different Clerk id than the one Clerk has for this email', () => {
    expect(
      decideClerkAction(
        baseInput({ clerkMatchId: 'clerk_new', clerkMatchOwnerUserId: null, localUserClerkId: 'clerk_old' }),
      ),
    ).toEqual({ action: 'conflict', reason: 'staff_mismatch' });
  });

  it('flags a conflict when the local user claims a Clerk link but Clerk has no account for this email/phone', () => {
    expect(
      decideClerkAction(baseInput({ clerkMatchId: null, localUserClerkId: 'clerk_stale' })),
    ).toEqual({ action: 'conflict', reason: 'local_link_not_found_in_clerk' });
  });
});
