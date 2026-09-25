import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService, CLERK_PUSH_QUEUE, type IdentityClerkPushMessage } from '@htownautos/rabbitmq';
import { PrismaService } from '@htownautos/prisma';
import { createClerkAdminClient, type ClerkAdminClient } from '@htownautos/auth';
import { normalizePhoneNumber, isSyntheticClerkEmail } from '@htownautos/common';
import type { ClerkSyncStatus } from '@prisma/client';
import { classifyClerkError } from './clerk-error.util';
import { IdentityQuotaNotifierService } from './identity-quota-notifier.service';
import { hashDesiredState, type DesiredClerkState } from './clerk-desired-state';

/** FAILED rows stop being swept after this many attempts (see the sweep cron). */
export const MAX_CLERK_SYNC_ATTEMPTS = 8;

/**
 * CRM -> Clerk identity push (CLERK-SYNC-DESIGN.md, package B2).
 *
 * Always rereads the `User` + its `Buyer`s fresh from the DB before touching
 * Clerk — a retried or duplicate message for the same userId is a no-op past
 * the hash check, never a double side effect. `prefetch: 1` (see
 * RabbitMQService.consume) keeps this strictly serial, which matters because
 * linking-by-email does a Clerk lookup then a write with no lock in between.
 */
@Injectable()
export class IdentityClerkPushConsumer implements OnModuleInit {
  private readonly logger = new Logger(IdentityClerkPushConsumer.name);
  private readonly clerk: ClerkAdminClient = createClerkAdminClient();

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly quotaNotifier: IdentityQuotaNotifierService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.CLERK_SYNC_ENABLED !== 'true') {
      this.logger.log('CLERK_SYNC_ENABLED != "true" — identity.clerk.push consumer stays idle');
      return;
    }
    await this.rabbitMQ.consume(
      CLERK_PUSH_QUEUE,
      async (raw) => this.handle(raw as IdentityClerkPushMessage),
      { prefetch: 1 },
    );
  }

  private async handle(msg: IdentityClerkPushMessage): Promise<void> {
    if (!msg?.userId) return;
    await this.pushUser(msg.userId);
  }

  async pushUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logger.warn(`pushUser: user ${userId} not found — dropping`);
      return;
    }

    const portalBuyers = await this.prisma.buyer.findMany({
      where: { userId, tenant: { customerPortalEnabled: true } },
      select: { tenantId: true },
    });

    // No portal presence left for this identity (buyer removed, or was never
    // a portal buyer) — CRM decision 5: delete = ban (reversible), never a
    // hard delete from this path.
    //
    // SAFETY GUARD (added in B3): a STAFF user reaches this branch too — they
    // never had a portal Buyer to begin with, e.g. an org-membership webhook
    // enqueues a push after every role change. Never let a STAFF identity
    // hit banIfLinked; only refresh their Clerk metadata instead. See
    // ClerkEventsConsumer.handleMembershipChanged.
    if (portalBuyers.length === 0) {
      if (user.userType === 'STAFF') {
        await this.refreshStaffMetadata(user.id, user.clerkUserId);
        return;
      }
      await this.banIfLinked(user.id, user.clerkUserId);
      return;
    }

    const customerTenantIds = [
      ...new Set(portalBuyers.map((b) => b.tenantId).filter((v): v is string => !!v)),
    ];
    const desired: DesiredClerkState = {
      email: user.email,
      phone: normalizePhoneNumber(user.phoneNumber),
      firstName: user.firstName,
      lastName: user.lastName,
      externalId: user.id,
      publicMetadata: { userType: user.userType, customerTenantIds, crmUserId: user.id },
    };
    const hash = hashDesiredState(desired);

    if (hash === user.clerkSyncHash && user.clerkUserId) {
      // Loop guard / no-op: nothing changed since the last successful push.
      await this.markSynced(user.id, user.clerkUserId, hash);
      return;
    }

    try {
      const clerkUserId = user.clerkUserId
        ? await this.updateLinkedUser(user.clerkUserId, desired)
        : await this.linkOrCreateUser(desired);

      await this.markSynced(user.id, clerkUserId, hash);
    } catch (err) {
      await this.markFailed(user.id, user.clerkSyncAttempts, err);
    }
  }

  // ── Clerk-side operations ────────────────────────────────────────────────

  private async findByIdentifier(desired: DesiredClerkState): Promise<string | null> {
    // Synthetic no-email placeholders (SMS-only sign-up, see
    // incomplete-profile.utils.ts) were never issued by Clerk — a lookup
    // would always miss, and it's never safe to use as a real identifier.
    if (!isSyntheticClerkEmail(desired.email)) {
      const byEmail = await this.clerk.users.getUserList({ emailAddress: [desired.email], limit: 1 });
      if (byEmail.data.length > 0) return byEmail.data[0].id;
    }

    if (desired.phone) {
      const byPhone = await this.clerk.users.getUserList({ phoneNumber: [desired.phone], limit: 1 });
      if (byPhone.data.length > 0) return byPhone.data[0].id;
    }
    return null;
  }

  private async linkOrCreateUser(desired: DesiredClerkState): Promise<string> {
    const existingId = await this.findByIdentifier(desired);

    if (existingId) {
      // Link WITHOUT touching the password — this is the exact account-
      // takeover vector the P0 hotfix closed in ClerkService.createUser().
      return this.updateLinkedUser(existingId, desired);
    }

    const created = await this.clerk.users.createUser({
      emailAddress: isSyntheticClerkEmail(desired.email) ? undefined : [desired.email],
      phoneNumber: desired.phone ? [desired.phone] : undefined,
      firstName: desired.firstName ?? undefined,
      lastName: desired.lastName ?? undefined,
      externalId: desired.externalId,
      publicMetadata: desired.publicMetadata,
      skipPasswordRequirement: true,
    });
    return created.id;
  }

  private async updateLinkedUser(clerkUserId: string, desired: DesiredClerkState): Promise<string> {
    await this.clerk.users.updateUser(clerkUserId, {
      firstName: desired.firstName ?? undefined,
      lastName: desired.lastName ?? undefined,
      externalId: desired.externalId,
    });
    // Never write the synthetic no-email placeholder into Clerk as a real
    // address — it would silently replace a real login email with garbage.
    if (!isSyntheticClerkEmail(desired.email)) {
      await this.ensurePrimaryEmail(clerkUserId, desired.email);
    }
    if (desired.phone) {
      await this.ensurePrimaryPhone(clerkUserId, desired.phone);
    }
    await this.clerk.users.updateUserMetadata(clerkUserId, { publicMetadata: desired.publicMetadata });
    return clerkUserId;
  }

  /** Create + set primary; the previous email address (if any) is left in place, never deleted here. */
  private async ensurePrimaryEmail(clerkUserId: string, email: string): Promise<void> {
    const clerkUser = await this.clerk.users.getUser(clerkUserId);
    const existing = clerkUser.emailAddresses.find((e) => e.emailAddress.toLowerCase() === email.toLowerCase());
    if (existing) {
      if (clerkUser.primaryEmailAddressId !== existing.id) {
        await this.clerk.users.updateUser(clerkUserId, { primaryEmailAddressID: existing.id });
      }
      return;
    }
    const created = await this.clerk.emailAddresses.createEmailAddress({
      userId: clerkUserId,
      emailAddress: email,
      verified: true,
      primary: false,
    });
    await this.clerk.users.updateUser(clerkUserId, { primaryEmailAddressID: created.id });
  }

  /** Same shape as ensurePrimaryEmail — phone is a login identifier too (email code + SMS code). */
  private async ensurePrimaryPhone(clerkUserId: string, phone: string): Promise<void> {
    const clerkUser = await this.clerk.users.getUser(clerkUserId);
    const existing = clerkUser.phoneNumbers.find((p) => p.phoneNumber === phone);
    if (existing) {
      if (clerkUser.primaryPhoneNumberId !== existing.id) {
        await this.clerk.users.updateUser(clerkUserId, { primaryPhoneNumberID: existing.id });
      }
      return;
    }
    const created = await this.clerk.phoneNumbers.createPhoneNumber({
      userId: clerkUserId,
      phoneNumber: phone,
      verified: true,
      primary: false,
    });
    await this.clerk.users.updateUser(clerkUserId, { primaryPhoneNumberID: created.id });
  }

  /** STAFF-only counterpart of banIfLinked: keep Clerk metadata current, never ban. */
  private async refreshStaffMetadata(userId: string, clerkUserId: string | null): Promise<void> {
    try {
      if (clerkUserId) {
        await this.clerk.users.updateUserMetadata(clerkUserId, {
          publicMetadata: { userType: 'STAFF', customerTenantIds: [], crmUserId: userId },
        });
      }
      await this.prisma.user.update({
        where: { id: userId },
        data: { clerkSyncStatus: 'SKIPPED', clerkSyncedAt: new Date(), clerkSyncError: null },
      });
    } catch (err) {
      await this.markFailed(userId, 0, err);
    }
  }

  private async banIfLinked(userId: string, clerkUserId: string | null): Promise<void> {
    try {
      if (clerkUserId) {
        await this.clerk.users.banUser(clerkUserId);
      }
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          clerkSyncStatus: 'SKIPPED',
          clerkSyncedAt: new Date(),
          clerkSyncHash: null,
          clerkSyncAttempts: 0,
          clerkSyncError: null,
        },
      });
    } catch (err) {
      await this.markFailed(userId, 0, err);
    }
  }

  // ── DB status bookkeeping ────────────────────────────────────────────────

  private async markSynced(userId: string, clerkUserId: string, hash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        clerkUserId,
        clerkSyncStatus: 'SYNCED' as ClerkSyncStatus,
        clerkSyncedAt: new Date(),
        clerkSyncHash: hash,
        clerkSyncAttempts: 0,
        clerkSyncError: null,
      },
    });
  }

  private async markFailed(userId: string, previousAttempts: number, err: unknown): Promise<void> {
    const classified = classifyClerkError(err);
    const attempts = previousAttempts + 1;

    if (classified.code === 'user_quota_exceeded') {
      await this.quotaNotifier.notifyOnce();
    }

    // Transient errors stay PENDING so the sweep's ">2min" re-publish picks
    // them up quickly, instead of burning one of the 8 FAILED-backoff slots.
    const status: ClerkSyncStatus = classified.transient ? 'PENDING' : 'FAILED';

    this.logger.warn(`pushUser: ${userId} → ${status} (${classified.code}) — ${classified.message}`);

    await this.prisma.user
      .update({
        where: { id: userId },
        data: {
          clerkSyncStatus: status,
          clerkSyncAttempts: attempts,
          clerkSyncError: `${classified.code}: ${classified.message}`.slice(0, 500),
        },
      })
      .catch((updateErr) => {
        this.logger.error(`markFailed: could not persist status for ${userId} — ${(updateErr as Error).message}`);
      });
  }
}
