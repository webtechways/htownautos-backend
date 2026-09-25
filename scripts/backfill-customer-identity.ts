/**
 * One-off backfill: for every Buyer of a customer-portal-enabled tenant,
 * resolve/link/create the single-identity `User` row (mirrors
 * `ensureUserForBuyer`'s match order — buyer.userId -> email -> phone) and
 * report what the Clerk side of that identity looks like today.
 *
 * Never calls a Clerk *write* endpoint (createUser/updateUser/banUser) —
 * only read-only `getUserList`/`getUser` lookups, used purely to classify
 * each buyer into an action. The actual Clerk write always happens later, in
 * the existing `identity.clerk.push` consumer (data-sync), which already has
 * its own rate limiting / retry / password-safety logic. See
 * docs/identity/CLERK-SYNC-DESIGN.md (package B5).
 *
 * Actions:
 *   - skip     no email, or tenant is not customer-portal-enabled
 *   - create   no Clerk account exists yet for this email/phone
 *   - link     a Clerk account already exists for this email/phone
 *   - conflict the Clerk account found is already claimed by a DIFFERENT CRM
 *              User, or this buyer's local User.clerkUserId disagrees with
 *              what Clerk has on file for its own email/phone — needs a
 *              human, never auto-resolved by this script.
 *
 * Also detects `users.clerkUserId` / `buyers.clerk_user_id` that 404 in
 * Clerk (stale links left over from deleted Clerk accounts) and, in
 * --apply, nulls them.
 *
 * Usage:
 *   npx ts-node scripts/backfill-customer-identity.ts --dry-run [--tenant <id>]   # default, report only
 *   npx ts-node scripts/backfill-customer-identity.ts --apply   [--tenant <id>]   # sets User PENDING + enqueues identity.clerk.push
 *
 * Per house rules, this script is written but NOT run by the backend agent —
 * CI/CD runs it against production with the user's approval.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizePhoneNumber } from '@htownautos/common';
import { createClerkAdminClient, ensureUserForBuyer, type ClerkAdminClient } from '@htownautos/auth';
import { RabbitMQService, CLERK_PUSH_QUEUE } from '@htownautos/rabbitmq';
import { PrismaService } from '@htownautos/prisma';

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;
const TENANT_FILTER = (() => {
  const idx = process.argv.indexOf('--tenant');
  return idx >= 0 ? process.argv[idx + 1] : undefined;
})();

/** Clerk read-only look-ups (dry-run classification AND apply's stale-link
 * check) are batched to stay well under Clerk's dev-instance rate limits. */
const CLERK_LOOKUP_BATCH_SIZE = 10;
const CLERK_LOOKUP_BATCH_PAUSE_MS = 200;

// ── Pure decision logic (unit-tested in backfill-customer-identity.spec.ts) ──

export type ClerkAction = 'link' | 'create' | 'skip' | 'conflict';

export interface DecideClerkActionInput {
  /** Buyer.email, normalised (lowercased/trimmed), or null if missing. */
  email: string | null;
  /** Tenant.customerPortalEnabled for this buyer's tenant. */
  portalEnabled: boolean;
  /** The local User.id this buyer resolves to (buyer.userId, or matched by email/phone), if any. */
  localUserId: string | null;
  /** That local User's current clerkUserId, if any. */
  localUserClerkId: string | null;
  /** Clerk user id found via getUserList by email/phone, if any. */
  clerkMatchId: string | null;
  /** The CRM User.id that currently has clerkUserId === clerkMatchId, if any. */
  clerkMatchOwnerUserId: string | null;
}

export interface ClerkActionDecision {
  action: ClerkAction;
  reason: string;
}

export function decideClerkAction(input: DecideClerkActionInput): ClerkActionDecision {
  if (!input.portalEnabled) return { action: 'skip', reason: 'non_portal_tenant' };
  if (!input.email) return { action: 'skip', reason: 'no_email' };

  if (input.clerkMatchId) {
    if (input.clerkMatchOwnerUserId && input.clerkMatchOwnerUserId !== input.localUserId) {
      return { action: 'conflict', reason: 'clerk_user_linked_to_another_crm_user' };
    }
    if (input.localUserClerkId && input.localUserClerkId !== input.clerkMatchId) {
      return { action: 'conflict', reason: 'staff_mismatch' };
    }
    return { action: 'link', reason: 'clerk_user_found_by_email_or_phone' };
  }

  if (input.localUserClerkId) {
    // Local row claims a Clerk link, but Clerk has no account for this
    // buyer's current email/phone — the local link is stale (the separate
    // 404 sweep below is the authoritative check for that; this is just a
    // secondary signal that something here needs a human).
    return { action: 'conflict', reason: 'local_link_not_found_in_clerk' };
  }

  return { action: 'create', reason: 'no_clerk_account_found' };
}

// ── Batching helper ──────────────────────────────────────────────────────

async function processInBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CLERK_LOOKUP_BATCH_SIZE) {
    const batch = items.slice(i, i + CLERK_LOOKUP_BATCH_SIZE);
    await Promise.all(batch.map(fn));
    if (i + CLERK_LOOKUP_BATCH_SIZE < items.length) {
      await new Promise((resolve) => setTimeout(resolve, CLERK_LOOKUP_BATCH_PAUSE_MS));
    }
  }
}

function isClerkNotFound(err: unknown): boolean {
  return (err as { status?: number })?.status === 404;
}

async function findClerkUserByEmailOrPhone(
  clerk: ClerkAdminClient,
  email: string,
  phone: string | null,
): Promise<string | null> {
  try {
    const byEmail = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
    if (byEmail.data.length > 0) return byEmail.data[0].id;
  } catch (err) {
    console.warn(`  ! Clerk email lookup failed for ${email}: ${(err as Error).message}`);
  }
  if (phone) {
    try {
      const byPhone = await clerk.users.getUserList({ phoneNumber: [phone], limit: 1 });
      if (byPhone.data.length > 0) return byPhone.data[0].id;
    } catch (err) {
      console.warn(`  ! Clerk phone lookup failed for ${phone}: ${(err as Error).message}`);
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Customer <-> Clerk identity backfill — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${TENANT_FILTER ? `, tenant: ${TENANT_FILTER}` : ''}\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const rawPrisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const clerk = createClerkAdminClient();

  // ensureUserForBuyer takes the app's PrismaService wrapper, not the raw
  // client (it has private fields, so it's not structurally assignable) —
  // stand it up the same way Nest would, just outside DI.
  const prismaService = new PrismaService();
  await prismaService.onModuleInit();

  const rabbitMQ = new RabbitMQService();
  if (APPLY) await rabbitMQ.onModuleInit();

  const totals: Record<ClerkAction, number> = { link: 0, create: 0, skip: 0, conflict: 0 };

  try {
    const buyers = await rawPrisma.buyer.findMany({
      where: {
        tenantId: TENANT_FILTER ?? undefined,
        tenant: { customerPortalEnabled: true },
      },
      select: {
        id: true,
        tenantId: true,
        email: true,
        phoneMain: true,
        firstName: true,
        lastName: true,
        userId: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${buyers.length} buyer(s) in customer-portal-enabled tenant(s).\n`);

    await processInBatches(buyers, async (buyer) => {
      const email = buyer.email?.trim().toLowerCase() || null;
      const phone = normalizePhoneNumber(buyer.phoneMain);

      if (!email) {
        totals.skip++;
        console.log(`[${buyer.tenantId}] buyer ${buyer.id} -> SKIP (no_email)`);
        return;
      }

      // Resolve the local User the same way ensureUserForBuyer would (read-only).
      let localUserId = buyer.userId;
      if (!localUserId) {
        const byEmail = await rawPrisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        localUserId = byEmail?.id ?? null;
        if (!localUserId && phone) {
          const byPhone = await rawPrisma.user.findFirst({ where: { phoneNumber: phone }, select: { id: true } });
          localUserId = byPhone?.id ?? null;
        }
      }
      const localUser = localUserId
        ? await rawPrisma.user.findUnique({ where: { id: localUserId }, select: { clerkUserId: true } })
        : null;

      const clerkMatchId = await findClerkUserByEmailOrPhone(clerk, email, phone);
      const clerkMatchOwner = clerkMatchId
        ? await rawPrisma.user.findFirst({ where: { clerkUserId: clerkMatchId }, select: { id: true } })
        : null;

      const decision = decideClerkAction({
        email,
        portalEnabled: true, // guaranteed by the query filter above
        localUserId,
        localUserClerkId: localUser?.clerkUserId ?? null,
        clerkMatchId,
        clerkMatchOwnerUserId: clerkMatchOwner?.id ?? null,
      });
      totals[decision.action]++;
      console.log(`[${buyer.tenantId}] buyer ${buyer.id} (${email}) -> ${decision.action.toUpperCase()} (${decision.reason})`);

      if (!APPLY) return;
      if (decision.action === 'conflict') return; // never auto-resolved

      const { userId, shouldPublish } = await ensureUserForBuyer(prismaService, {
        buyerId: buyer.id,
        tenantId: buyer.tenantId!,
        email: buyer.email,
        phoneMain: buyer.phoneMain,
        firstName: buyer.firstName,
        lastName: buyer.lastName,
      });
      if (shouldPublish && userId) {
        await rabbitMQ.publish(CLERK_PUSH_QUEUE, { userId });
      }
    });

    console.log(
      `\nTotals — link: ${totals.link}, create: ${totals.create}, skip: ${totals.skip}, conflict: ${totals.conflict}`,
    );

    // ── Stale clerkUserId links (404 in Clerk) ──────────────────────────
    console.log(`\nChecking for stale clerkUserId links (deleted Clerk accounts)...`);

    const linkedUsers = await rawPrisma.user.findMany({
      where: { clerkUserId: { not: null } },
      select: { id: true, clerkUserId: true, email: true },
    });
    const linkedBuyers = await rawPrisma.buyer.findMany({
      where: { clerkUserId: { not: null } },
      select: { id: true, clerkUserId: true, email: true },
    });

    const staleUsers: typeof linkedUsers = [];
    const staleBuyers: typeof linkedBuyers = [];

    await processInBatches(linkedUsers, async (u) => {
      try {
        await clerk.users.getUser(u.clerkUserId as string);
      } catch (err) {
        if (isClerkNotFound(err)) staleUsers.push(u);
        else console.warn(`  ! Clerk lookup failed for User ${u.id}: ${(err as Error).message}`);
      }
    });
    await processInBatches(linkedBuyers, async (b) => {
      try {
        await clerk.users.getUser(b.clerkUserId as string);
      } catch (err) {
        if (isClerkNotFound(err)) staleBuyers.push(b);
        else console.warn(`  ! Clerk lookup failed for Buyer ${b.id}: ${(err as Error).message}`);
      }
    });

    for (const u of staleUsers) {
      console.log(`  STALE users.clerkUserId: User ${u.id} (${u.email}) -> ${u.clerkUserId} (404 in Clerk)`);
    }
    for (const b of staleBuyers) {
      console.log(`  STALE buyers.clerk_user_id: Buyer ${b.id} (${b.email}) -> ${b.clerkUserId} (404 in Clerk)`);
    }
    console.log(`Stale: ${staleUsers.length} user(s), ${staleBuyers.length} buyer(s).`);

    if (APPLY) {
      for (const u of staleUsers) {
        await rawPrisma.user.update({
          where: { id: u.id },
          data: {
            clerkUserId: null,
            clerkSyncStatus: 'PENDING',
            clerkSyncHash: null,
            clerkSyncAttempts: 0,
            clerkSyncError: 'stale_clerk_link_404_backfill',
          },
        });
      }
      for (const b of staleBuyers) {
        await rawPrisma.buyer.update({ where: { id: b.id }, data: { clerkUserId: null } });
      }
      console.log(`Nulled ${staleUsers.length} stale users.clerkUserId and ${staleBuyers.length} stale buyers.clerk_user_id.`);
    }
  } finally {
    if (APPLY) await rabbitMQ.onModuleDestroy();
    await prismaService.onModuleDestroy();
    await rawPrisma.$disconnect();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
