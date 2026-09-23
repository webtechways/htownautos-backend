import { Injectable } from '@nestjs/common';
import { Prisma, type SocialComment, type InboxConversation, type InboxMessage } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';

const ROOT_LOOKUP_MAX_HOPS = 5;
const PREVIEW_MAX_CHARS = 140;

/** Normalized comment/mention/review, already mapped from a platform's own webhook/poll shape. */
export interface NormalizedComment {
  tenantId: string;
  accountId: string;
  platform: string;
  kind: 'comment' | 'mention' | 'review';
  externalId: string;
  /** The platform's id of the parent comment, when this is a reply. Resolved to our own `parentId` internally. */
  externalParentId?: string | null;
  externalPostId?: string | null;
  postTargetId?: string | null;
  postPreview?: Prisma.InputJsonValue | null;
  authorName: string;
  authorHandle?: string | null;
  authorAvatarUrl?: string | null;
  authorExternalId?: string | null;
  body: string;
  permalink?: string | null;
  rating?: number | null;
  fromUs?: boolean;
  platformCreatedAt: Date;
}

/** Normalized inbox message, from any channel (SMS, WhatsApp, or a social DM). */
export interface NormalizedInboxMessage {
  tenantId: string;
  channel: string;
  provider: string;
  senderKind: 'twilio_number' | 'social_account';
  senderKey: string;
  socialAccountId?: string | null;
  twilioPhoneNumberId?: string | null;
  contactExternalId: string;
  contactName?: string | null;
  contactHandle?: string | null;
  contactPhone?: string | null;
  contactAvatarUrl?: string | null;
  buyerId?: string | null;
  direction: 'inbound' | 'outbound';
  body?: string | null;
  attachments?: Prisma.InputJsonValue;
  status: string;
  externalId?: string | null;
  smsMessageId?: string | null;
  sentById?: string | null;
  error?: string | null;
  platformCreatedAt: Date;
  deliveredAt?: Date | null;
  readAt?: Date | null;
}

/**
 * Idempotent write path for everything that flows INTO the Social Suite from
 * the outside world: platform webhooks/polls (comments) and every DM/SMS
 * channel (inbox). Used by both apps — the api's Meta/webhook controllers
 * and data-sync's pollers all funnel through here so the "new comment
 * reopens a done thread" / "0→1 unread notifies" rules live in one place.
 */
@Injectable()
export class SocialIngestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts a comment/mention/review, idempotent on (accountId, externalId).
   * Resolves `externalParentId` to our own row id when the parent is already
   * known (out-of-order delivery keeps `externalParentId` for later
   * reconciliation). Reopens the thread's root when a new, not-from-us
   * comment lands on a thread already marked `done`.
   */
  async upsertComment(input: NormalizedComment): Promise<{ comment: SocialComment; isNew: boolean }> {
    const existing = await this.prisma.socialComment.findUnique({
      where: { accountId_externalId: { accountId: input.accountId, externalId: input.externalId } },
    });

    let parentId: string | null = null;
    if (input.externalParentId) {
      const parent = await this.prisma.socialComment.findUnique({
        where: { accountId_externalId: { accountId: input.accountId, externalId: input.externalParentId } },
      });
      parentId = parent?.id ?? null;
    }

    const data = {
      tenantId: input.tenantId,
      accountId: input.accountId,
      platform: input.platform,
      kind: input.kind,
      externalId: input.externalId,
      parentId,
      externalParentId: input.externalParentId ?? null,
      externalPostId: input.externalPostId ?? null,
      postTargetId: input.postTargetId ?? null,
      postPreview: input.postPreview ?? Prisma.JsonNull,
      authorName: input.authorName,
      authorHandle: input.authorHandle ?? null,
      authorAvatarUrl: input.authorAvatarUrl ?? null,
      authorExternalId: input.authorExternalId ?? null,
      body: input.body,
      permalink: input.permalink ?? null,
      rating: input.rating ?? null,
      fromUs: input.fromUs ?? false,
      platformCreatedAt: input.platformCreatedAt,
    };

    const comment = existing
      ? await this.prisma.socialComment.update({ where: { id: existing.id }, data })
      : await this.prisma.socialComment.create({ data });

    if (!existing && parentId && !input.fromUs) {
      await this.reopenRootIfDone(parentId);
    }

    return { comment, isNew: !existing };
  }

  /** Walks up `parentId` to find the thread's root and, if it's `done`, reopens it. */
  private async reopenRootIfDone(startId: string): Promise<void> {
    let currentId = startId;
    for (let hop = 0; hop < ROOT_LOOKUP_MAX_HOPS; hop++) {
      const row = await this.prisma.socialComment.findUnique({
        where: { id: currentId },
        select: { id: true, parentId: true, status: true },
      });
      if (!row) return;
      if (!row.parentId) {
        if (row.status === 'done') {
          await this.prisma.socialComment.update({ where: { id: row.id }, data: { status: 'open' } });
        }
        return;
      }
      currentId = row.parentId;
    }
  }

  /**
   * Finds-or-creates the InboxConversation for `input`, records the message
   * (idempotent on `smsMessageId` when set, else on (channel, externalId)),
   * and updates the conversation's counters/preview. A `done` conversation
   * reopens on new inbound traffic, mirroring the comment-thread rule.
   */
  async recordInboxMessage(input: NormalizedInboxMessage): Promise<{
    conversation: InboxConversation;
    message: InboxMessage;
    isNew: boolean;
    becameUnread: boolean;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const conversation = await this.upsertConversation(tx, input);

      const existing = input.smsMessageId
        ? await tx.inboxMessage.findUnique({ where: { smsMessageId: input.smsMessageId } })
        : input.externalId
          ? await tx.inboxMessage.findUnique({
              where: { channel_externalId: { channel: input.channel, externalId: input.externalId } },
            })
          : null;

      const messageData = {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        channel: input.channel,
        direction: input.direction,
        body: input.body ?? null,
        attachments: input.attachments ?? [],
        status: input.status,
        error: input.error ?? null,
        sentById: input.sentById ?? null,
        externalId: input.externalId ?? null,
        smsMessageId: input.smsMessageId ?? null,
        platformCreatedAt: input.platformCreatedAt,
        deliveredAt: input.deliveredAt ?? null,
        readAt: input.readAt ?? null,
      };

      const isNew = !existing;
      const message = existing
        ? await tx.inboxMessage.update({ where: { id: existing.id }, data: messageData })
        : await tx.inboxMessage.create({ data: messageData });

      const becameUnread = isNew && input.direction === 'inbound' && conversation.unreadCount === 0;
      const preview = (input.body ?? '').slice(0, PREVIEW_MAX_CHARS) || (input.body == null ? null : '[adjunto]');

      const updatedConversation = await tx.inboxConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: input.platformCreatedAt,
          lastMessagePreview: preview,
          lastDirection: input.direction,
          ...(input.direction === 'inbound'
            ? {
                lastInboundAt: input.platformCreatedAt,
                ...(isNew ? { unreadCount: { increment: 1 } } : {}),
                ...(conversation.status === 'done' ? { status: 'open' as const } : {}),
              }
            : {}),
        },
      });

      return { conversation: updatedConversation, message, isNew, becameUnread };
    });
  }

  private async upsertConversation(
    tx: Prisma.TransactionClient,
    input: NormalizedInboxMessage,
  ): Promise<InboxConversation> {
    const where = {
      tenantId_channel_senderKey_contactExternalId: {
        tenantId: input.tenantId,
        channel: input.channel,
        senderKey: input.senderKey,
        contactExternalId: input.contactExternalId,
      },
    };

    const existing = await tx.inboxConversation.findUnique({ where });
    if (existing) {
      // Best-effort enrichment: fill in contact fields we didn't know before.
      const patch: Prisma.InboxConversationUpdateInput = {};
      if (!existing.contactName && input.contactName) patch.contactName = input.contactName;
      if (!existing.contactHandle && input.contactHandle) patch.contactHandle = input.contactHandle;
      if (!existing.contactPhone && input.contactPhone) patch.contactPhone = input.contactPhone;
      if (!existing.contactAvatarUrl && input.contactAvatarUrl) patch.contactAvatarUrl = input.contactAvatarUrl;
      if (!existing.buyerId && input.buyerId) patch.buyer = { connect: { id: input.buyerId } };
      if (Object.keys(patch).length === 0) return existing;
      return tx.inboxConversation.update({ where: { id: existing.id }, data: patch });
    }

    return tx.inboxConversation.create({
      data: {
        tenantId: input.tenantId,
        channel: input.channel,
        provider: input.provider,
        senderKind: input.senderKind,
        senderKey: input.senderKey,
        socialAccountId: input.socialAccountId ?? null,
        twilioPhoneNumberId: input.twilioPhoneNumberId ?? null,
        contactExternalId: input.contactExternalId,
        contactName: input.contactName ?? null,
        contactHandle: input.contactHandle ?? null,
        contactPhone: input.contactPhone ?? null,
        contactAvatarUrl: input.contactAvatarUrl ?? null,
        buyerId: input.buyerId ?? null,
        status: 'open',
        unreadCount: 0,
      },
    });
  }
}
