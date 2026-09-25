import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RabbitMQService,
  CLERK_EVENTS_QUEUE,
  CLERK_PUSH_QUEUE,
  type IdentityClerkEventMessage,
} from '@htownautos/rabbitmq';
import { PrismaService } from '@htownautos/prisma';
import { recomputeUserType, PORTAL_TENANT_ID } from '@htownautos/auth';
import { normalizePhoneNumber } from '@htownautos/common';
import { hashDesiredState, type DesiredClerkState } from './clerk-desired-state';
import { PortalSignupNotifierService } from './portal-signup-notifier.service';

/** A poison event stops being swept after this many failed attempts. */
export const MAX_CLERK_EVENT_ATTEMPTS = 8;

// Loosely-typed reach-ins into the Clerk webhook JSON payload — only the
// fields this consumer actually uses. Full shapes live in
// `@clerk/backend/dist/api/resources/JSON.d.ts`; not re-imported here to
// keep this file decoupled from the SDK's webhook typings.
interface ClerkEmailAddress {
  id: string;
  email_address: string;
  verification: { status: string } | null;
}
interface ClerkPhoneNumber {
  id: string;
  phone_number: string;
  verification: { status: string } | null;
}
interface ClerkUserData {
  id: string;
  external_id: string | null;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
  email_addresses: ClerkEmailAddress[];
  phone_numbers: ClerkPhoneNumber[];
  primary_email_address_id: string | null;
  primary_phone_number_id: string | null;
  unsafe_metadata?: Record<string, unknown>;
  updated_at: number;
}
interface ClerkUserDeletedData {
  id: string;
  external_id?: string | null;
}
interface ClerkMembershipData {
  organization?: { id: string };
  public_user_data?: { user_id: string };
}

/**
 * Clerk -> CRM webhook event processor (CLERK-SYNC-DESIGN.md, package B3).
 *
 * Consumes `identity.clerk.events` (published by `ClerkWebhooksController`
 * after svix verification + idempotent insert into `clerk_webhook_events`).
 * `prefetch: 1` keeps this strictly serial per the shared design with the B2
 * push consumer. Re-reads the stored event row every time — a redelivered
 * message for an already-`processedAt` event is a no-op, never a double
 * apply.
 */
@Injectable()
export class ClerkEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(ClerkEventsConsumer.name);

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
    private readonly portalSignupNotifier: PortalSignupNotifierService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.CLERK_SYNC_ENABLED !== 'true') {
      this.logger.log('CLERK_SYNC_ENABLED != "true" — identity.clerk.events consumer stays idle');
      return;
    }
    await this.rabbitMQ.consume(
      CLERK_EVENTS_QUEUE,
      async (raw) => this.handle(raw as IdentityClerkEventMessage),
      { prefetch: 1 },
    );
  }

  private async handle(msg: IdentityClerkEventMessage): Promise<void> {
    if (!msg?.eventId) return;
    await this.processEvent(msg.eventId);
  }

  async processEvent(eventId: string): Promise<void> {
    const row = await this.prisma.clerkWebhookEvent.findUnique({ where: { id: eventId } });
    if (!row) {
      this.logger.warn(`processEvent: ${eventId} not found — dropping`);
      return;
    }
    if (row.processedAt) return; // already applied — redelivery no-op

    try {
      await this.applyEvent(row.type, row.payload as { data?: unknown });
      await this.prisma.clerkWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date(), error: null },
      });
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = (err as Error)?.message?.slice(0, 500) ?? 'unknown error';
      this.logger.warn(`processEvent: ${eventId} (${row.type}) attempt ${attempts} failed — ${message}`);
      await this.prisma.clerkWebhookEvent
        .update({ where: { id: eventId }, data: { attempts, error: message } })
        .catch((updateErr) => {
          this.logger.error(`processEvent: could not persist failure for ${eventId} — ${(updateErr as Error).message}`);
        });
    }
  }

  private async applyEvent(type: string, payload: { data?: unknown }): Promise<void> {
    const data = payload?.data;
    switch (type) {
      case 'user.created':
        return this.handleUserCreated(data as ClerkUserData);
      case 'user.updated':
        return this.handleUserUpdated(data as ClerkUserData);
      case 'user.deleted':
        return this.handleUserDeleted(data as ClerkUserDeletedData);
      case 'organizationMembership.created':
      case 'organizationMembership.updated':
      case 'organizationMembership.deleted':
        return this.handleMembershipChanged(data as ClerkMembershipData);
      default:
        // Stored for the record (audit / future reprocess) — nothing to apply.
        return;
    }
  }

  // ── user.* ────────────────────────────────────────────────────────────

  private extractPrimaryEmail(data: ClerkUserData): string | null {
    const primary = data.email_addresses?.find((e) => e.id === data.primary_email_address_id);
    if (!primary || primary.verification?.status !== 'verified') return null;
    return primary.email_address.trim().toLowerCase();
  }

  private extractPrimaryPhone(data: ClerkUserData): string | null {
    const primary = data.phone_numbers?.find((p) => p.id === data.primary_phone_number_id);
    if (!primary || primary.verification?.status !== 'verified') return null;
    return normalizePhoneNumber(primary.phone_number);
  }

  private async handleUserCreated(data: ClerkUserData): Promise<void> {
    if (!data?.id) return;

    // Idempotent re-delivery: already linked.
    let user = await this.prisma.user.findUnique({ where: { clerkUserId: data.id } });

    const email = this.extractPrimaryEmail(data);
    const phone = this.extractPrimaryPhone(data);

    if (!user && data.external_id) {
      // Matches a User we ourselves created in Clerk via the B2 push
      // (externalId = User.id there).
      const byExternalId = await this.prisma.user.findUnique({ where: { id: data.external_id } });
      if (byExternalId) {
        if (byExternalId.clerkUserId && byExternalId.clerkUserId !== data.id) {
          this.logger.warn(
            `user.created ${data.id}: externalId ${data.external_id} already linked to a different Clerk user (${byExternalId.clerkUserId}) — skipping link`,
          );
        } else {
          user = byExternalId;
        }
      }
    }

    if (!user && email) {
      const byEmail = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
      if (byEmail) {
        if (byEmail.clerkUserId && byEmail.clerkUserId !== data.id) {
          this.logger.warn(
            `user.created ${data.id}: email ${email} already linked to a different Clerk user (${byEmail.clerkUserId}) — skipping link`,
          );
        } else {
          user = byEmail;
        }
      }
    }

    if (!user) {
      // No verified email at all (e.g. SMS-only sign-up) — User.email is
      // NOT NULL + unique in this schema, so synthesize a placeholder tied
      // to the Clerk id rather than block account creation on it.
      const placeholderEmail = `${data.id}@clerk.no-email.htownautos.internal`;
      user = await this.prisma.user.create({
        data: {
          email: email ?? placeholderEmail,
          firstName: data.first_name || null,
          lastName: data.last_name || null,
          name: [data.first_name, data.last_name].filter(Boolean).join(' ') || email || data.id,
          phoneNumber: phone ?? undefined,
          avatar: data.image_url || undefined,
          userType: 'CUSTOMER',
        },
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        clerkUserId: data.id,
        email: email ?? user.email, // never null out an existing login email
        firstName: data.first_name || user.firstName,
        lastName: data.last_name || user.lastName,
        phoneNumber: phone ?? user.phoneNumber,
        avatar: data.image_url || user.avatar,
        clerkEventAt: new Date(data.updated_at),
      },
    });

    await recomputeUserType(this.prisma, user.id);

    if (data.unsafe_metadata?.signupSource === 'web') {
      await this.createWebSignupBuyer(user.id, {
        firstName: data.first_name,
        lastName: data.last_name,
        email: email ?? user.email,
        phone,
      });
    }

    await this.stampSyncedHash(user.id, data.id);
  }

  private async handleUserUpdated(data: ClerkUserData): Promise<void> {
    if (!data?.id) return;
    const user = await this.prisma.user.findUnique({ where: { clerkUserId: data.id } });
    if (!user) {
      this.logger.debug(`user.updated ${data.id}: no matching User — ignoring`);
      return;
    }

    const eventTime = new Date(data.updated_at);
    if (user.clerkEventAt && eventTime <= user.clerkEventAt) {
      this.logger.debug(`user.updated ${data.id}: stale/out-of-order event — ignoring`);
      return;
    }

    const incomingEmail = this.extractPrimaryEmail(data) ?? user.email;
    const incomingPhone = this.extractPrimaryPhone(data) ?? user.phoneNumber;
    const incomingFirstName = data.first_name ?? user.firstName;
    const incomingLastName = data.last_name ?? user.lastName;
    const incomingAvatar = data.image_url ?? user.avatar;

    const incomingState = await this.buildDesiredState(user.id, user.userType, {
      email: incomingEmail,
      phone: incomingPhone,
      firstName: incomingFirstName,
      lastName: incomingLastName,
    });
    const incomingHash = hashDesiredState(incomingState);

    if (incomingHash === user.clerkSyncHash) {
      // Echo of our own last push — nothing new to apply, just move the
      // ordering guard forward so a later stale duplicate is still caught.
      await this.prisma.user.update({ where: { id: user.id }, data: { clerkEventAt: eventTime } });
      return;
    }

    const oldEmail = user.email;
    const oldPhone = user.phoneNumber;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        email: incomingEmail,
        phoneNumber: incomingPhone,
        firstName: incomingFirstName,
        lastName: incomingLastName,
        avatar: incomingAvatar,
        clerkEventAt: eventTime,
        clerkSyncHash: incomingHash,
        clerkSyncStatus: 'SYNCED',
        clerkSyncedAt: new Date(),
      },
    });

    // Names always follow the freshest Clerk event on every linked Buyer.
    await this.prisma.buyer.updateMany({
      where: { userId: user.id },
      data: { firstName: incomingFirstName || undefined, lastName: incomingLastName || undefined },
    });

    // Contact email/phone on a Buyer only follow if they still equalled the
    // OLD login value — a CRM-entered contact detail that already diverged
    // on purpose is never clobbered by this loop guard.
    if (oldEmail && incomingEmail !== oldEmail) {
      await this.prisma.buyer.updateMany({
        where: { userId: user.id, email: { equals: oldEmail, mode: 'insensitive' } },
        data: { email: incomingEmail },
      });
    }
    if (oldPhone && incomingPhone && incomingPhone !== oldPhone) {
      await this.prisma.buyer.updateMany({
        where: { userId: user.id, phoneMain: oldPhone },
        data: { phoneMain: incomingPhone },
      });
    }
  }

  private async handleUserDeleted(data: ClerkUserDeletedData): Promise<void> {
    if (!data?.id) return;
    const user = await this.prisma.user.findUnique({ where: { clerkUserId: data.id } });
    if (!user) return;

    // Decision 5: delete in Clerk keeps the CRM Buyer(s) — never recreated
    // automatically, never hard-deleted from this path.
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        clerkUserId: null,
        clerkSyncStatus: 'SKIPPED',
        clerkSyncError: 'clerk_user_deleted',
        clerkSyncHash: null,
      },
    });
    this.logger.log(`user.deleted: unlinked Clerk user ${data.id} from CRM user ${user.id} — Buyers kept`);
  }

  // ── organizationMembership.* ─────────────────────────────────────────

  private async handleMembershipChanged(data: ClerkMembershipData): Promise<void> {
    const clerkUserId = data?.public_user_data?.user_id;
    if (!clerkUserId) return;
    const user = await this.prisma.user.findUnique({ where: { clerkUserId } });
    if (!user) return;

    // Ground truth for userType lives in TenantUser rows, already updated
    // synchronously by the controller's existing inline membership handling
    // before this event was even published.
    await recomputeUserType(this.prisma, user.id);

    // Refresh Clerk metadata (userType/customerTenantIds). Safe to always
    // enqueue: IdentityClerkPushConsumer now has a STAFF guard that refreshes
    // metadata instead of banning a no-portal-Buyer STAFF identity.
    await this.rabbitMQ.publish(CLERK_PUSH_QUEUE, { userId: user.id });
  }

  // ── shared helpers ────────────────────────────────────────────────────

  private async buildDesiredState(
    userId: string,
    userType: string,
    fields: { email: string; phone: string | null; firstName: string | null; lastName: string | null },
  ): Promise<DesiredClerkState> {
    const portalBuyers = await this.prisma.buyer.findMany({
      where: { userId, tenant: { customerPortalEnabled: true } },
      select: { tenantId: true },
    });
    const customerTenantIds = [...new Set(portalBuyers.map((b) => b.tenantId).filter((v): v is string => !!v))];
    return {
      email: fields.email,
      phone: normalizePhoneNumber(fields.phone),
      firstName: fields.firstName,
      lastName: fields.lastName,
      externalId: userId,
      publicMetadata: { userType, customerTenantIds, crmUserId: userId },
    };
  }

  /** After user.created applies, stamp clerkSyncHash so an unrelated future B2 push is a no-op. */
  private async stampSyncedHash(userId: string, clerkUserId: string): Promise<void> {
    const fresh = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!fresh) return;
    const state = await this.buildDesiredState(userId, fresh.userType, {
      email: fresh.email,
      phone: fresh.phoneNumber,
      firstName: fresh.firstName,
      lastName: fresh.lastName,
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        clerkSyncHash: hashDesiredState(state),
        clerkSyncStatus: 'SYNCED',
        clerkSyncedAt: new Date(),
        clerkSyncAttempts: 0,
        clerkSyncError: null,
      },
    });
  }

  private async createWebSignupBuyer(
    userId: string,
    info: { firstName: string | null; lastName: string | null; email: string; phone: string | null },
  ): Promise<void> {
    const existing = await this.prisma.buyer.findFirst({
      where: { userId, tenantId: PORTAL_TENANT_ID },
      select: { id: true },
    });
    if (existing) return; // idempotent re-delivery, or already linked another way

    // Required columns we have no real value for yet (DOB/address) get an
    // explicit placeholder — this is a lead stub, not a finished KYC record;
    // staff completes it via "Send portal access" / the buyer edit form.
    // phoneMain has a @@unique([tenantId, phoneMain]); '' would collide on a
    // second no-phone signup, so fall back to a per-user placeholder instead.
    const buyer = await this.prisma.buyer.create({
      data: {
        tenantId: PORTAL_TENANT_ID,
        userId,
        firstName: info.firstName || 'Cliente',
        lastName: info.lastName || 'Web',
        email: info.email,
        phoneMain: info.phone ?? `pending-${userId}`,
        dateOfBirth: new Date('1900-01-01'),
        currentAddress: '',
        currentCity: '',
        currentState: '',
        currentZipCode: '',
        source: 'web-signup',
        notes: 'Lead creado automáticamente por sign-up web (Clerk) — perfil incompleto, requiere seguimiento.',
      },
    });

    const displayName = `${info.firstName ?? ''} ${info.lastName ?? ''}`.trim() || info.email;
    await this.portalSignupNotifier.notify(buyer.id, displayName);
  }
}
