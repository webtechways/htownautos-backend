import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import {
  SocialIngestService,
  SocialNotifierService,
  SocialRealtimeService,
  SocialTokenService,
  extensionFromMime,
  graphUrl,
  type NormalizedInboxMessage,
} from '@htownautos/social';
import { Prisma, type SocialAccount } from '@prisma/client';

const MEDIA_UPLOAD_FOLDER = 'inbox-meta-media';
const ATTACHMENT_DOWNLOAD_TIMEOUT_MS = 10_000;
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** Verbatim (subset) shape of Meta's webhook payload for page/instagram/whatsapp_business_account objects. */
interface MetaWebhookBody {
  object: 'page' | 'instagram' | 'whatsapp_business_account' | string;
  entry: MetaWebhookEntry[];
}

interface MetaWebhookEntry {
  id: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
  changes?: MetaChangeEvent[];
}

interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{ type: string; payload: { url?: string } }>;
  };
}

interface MetaChangeEvent {
  field: string; // feed | comments | mentions | messages (WhatsApp)
  value: Record<string, unknown>;
}

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string };
  video?: { id: string; mime_type: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; filename?: string };
  sticker?: { id: string; mime_type: string };
}

interface WhatsAppStatus {
  id: string;
  status: string; // sent | delivered | read | failed
  timestamp: string;
  errors?: Array<{ title?: string }>;
}

@Injectable()
export class MetaWebhookService {
  private readonly logger = new Logger(MetaWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly tokens: SocialTokenService,
    private readonly ingest: SocialIngestService,
    private readonly notifier: SocialNotifierService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  /** `hub.mode`/`hub.verify_token`/`hub.challenge` handshake — GET /social/webhooks/meta. */
  verifyHandshake(mode: string | undefined, verifyToken: string | undefined): boolean {
    return mode === 'subscribe' && !!verifyToken && verifyToken === process.env.META_WEBHOOK_VERIFY_TOKEN;
  }

  /**
   * Validates `X-Hub-Signature-256` (HMAC-SHA256 of the raw body, hex,
   * prefixed `sha256=`) against every configured app secret — Facebook and
   * Instagram may be different apps. `rawBody` must be the exact bytes Meta
   * sent (see `main.ts`'s raw-body carve-out for this route).
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const provided = signatureHeader.slice('sha256='.length);
    const secrets = [process.env.FACEBOOK_APP_SECRET, process.env.INSTAGRAM_APP_SECRET].filter((s): s is string => !!s);
    if (secrets.length === 0) {
      this.logger.warn('verifySignature: no FACEBOOK_APP_SECRET/INSTAGRAM_APP_SECRET configured');
      return false;
    }
    return secrets.some((secret) => {
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(provided, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    });
  }

  /** Routes every entry in the payload — never throws (caller always answers 200 fast, per CONTRACT.md §3.7). */
  async handle(body: MetaWebhookBody): Promise<void> {
    for (const entry of body.entry ?? []) {
      try {
        if (body.object === 'whatsapp_business_account') {
          await this.handleWhatsAppEntry(entry);
        } else if (body.object === 'instagram') {
          await this.handleMessagingOrChanges(entry, 'instagram');
        } else if (body.object === 'page') {
          await this.handleMessagingOrChanges(entry, 'facebook');
        }
      } catch (err) {
        this.logger.error(`handle entry ${entry.id}: ${(err as Error).message}`);
      }
    }
  }

  // ─── Messenger / Instagram (messaging + feed/comments/mentions) ─────────

  private async handleMessagingOrChanges(entry: MetaWebhookEntry, platform: 'facebook' | 'instagram'): Promise<void> {
    const account = await this.prisma.socialAccount.findFirst({ where: { platform, platformAccountId: entry.id } });
    if (!account) {
      this.logger.warn(`No hay SocialAccount para ${platform}:${entry.id}`);
      return;
    }

    for (const event of entry.messaging ?? []) {
      await this.handleMessagingEvent(account, platform, event);
    }

    for (const change of entry.changes ?? []) {
      if (change.field === 'feed' || change.field === 'comments' || change.field === 'mentions') {
        await this.handleCommentChange(account, platform, change);
      }
    }
  }

  private async handleMessagingEvent(account: SocialAccount, platform: 'facebook' | 'instagram', event: MetaMessagingEvent): Promise<void> {
    if (!event.message) return; // delivery/read receipts without a message body — nothing to mirror yet
    const isEcho = event.message.is_echo === true;
    const contactExternalId = isEcho ? event.recipient.id : event.sender.id;
    const channel = platform === 'facebook' ? 'messenger' : 'instagram';
    const mid = event.message.mid;

    const attachments = (event.message.attachments ?? []).map((a) => ({
      kind: a.type === 'image' ? 'image' : a.type === 'video' ? 'video' : a.type === 'audio' ? 'audio' : 'file',
      url: a.payload.url ?? null,
      mimeType: null,
      name: null,
    }));

    await this.recordAndNotify({
      tenantId: account.tenantId,
      channel,
      provider: 'meta',
      senderKind: 'social_account',
      senderKey: account.id,
      socialAccountId: account.id,
      contactExternalId,
      direction: isEcho ? 'outbound' : 'inbound',
      body: event.message.text ?? null,
      attachments: attachments.length > 0 ? attachments : undefined,
      status: isEcho ? 'sent' : 'received',
      externalId: mid,
      platformCreatedAt: new Date(event.timestamp),
    });

    // Fire-and-forget: Meta's CDN URL is already stored as a working fallback, so we never
    // block the 200-ack on this. Downloads into our own bucket and swaps `url` for `key`
    // (fresh signed URL at read time) once done — best-effort, per attachment.
    if (attachments.length > 0) {
      void this.backfillMessengerAttachments(account.tenantId, channel, mid, attachments).catch((err) =>
        this.logger.warn(`backfillMessengerAttachments ${mid}: ${(err as Error).message}`),
      );
    }
  }

  /** Downloads each Messenger/Instagram attachment (still pointing at Meta's CDN `url`) into the private bucket and swaps it for a `key`, so `toInboxMessageView` serves it as a fresh signed URL. Runs after the webhook already ack'd 200 — never awaited by the caller. */
  private async backfillMessengerAttachments(
    tenantId: string,
    channel: 'messenger' | 'instagram',
    externalId: string,
    attachments: Array<{ kind: string; url: string | null; mimeType: string | null; name: string | null }>,
  ): Promise<void> {
    const updated = await Promise.all(
      attachments.map(async (a) => {
        if (!a.url) return a;
        const downloaded = await this.downloadAttachment(a.url, tenantId);
        return downloaded ? { kind: a.kind, key: downloaded.key, mimeType: downloaded.mimeType, name: a.name } : a; // keep the original url on failure — never drop the message's attachment
      }),
    );

    const updatedMessage = await this.prisma.inboxMessage
      .update({ where: { channel_externalId: { channel, externalId } }, data: { attachments: updated as unknown as Prisma.InputJsonValue } })
      .catch(() => null); // the message row may not exist yet under heavy webhook reordering — safe to drop, nothing else depends on this
    if (!updatedMessage) return;

    await this.realtime.emit(tenantId, 'inbox:message', { conversationId: updatedMessage.conversationId });
  }

  /** Downloads one attachment with a 10s timeout and a 25MB cap, copying it into the private bucket (same `uploadBuffer` helper `SmsService` uses for MMS). Returns `null` on any failure — the caller keeps the original platform URL. */
  private async downloadAttachment(url: string, tenantId: string): Promise<{ key: string; mimeType: string } | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTACHMENT_DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const declaredLength = Number(res.headers.get('content-length') ?? '0');
      if (declaredLength > ATTACHMENT_MAX_BYTES) throw new Error(`too large: ${declaredLength} bytes`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > ATTACHMENT_MAX_BYTES) throw new Error(`too large: ${buffer.byteLength} bytes`);
      const mimeType = res.headers.get('content-type') ?? 'application/octet-stream';
      const { key } = await this.s3.uploadBuffer(buffer, `${MEDIA_UPLOAD_FOLDER}/${tenantId}`, extensionFromMime(mimeType), mimeType);
      return { key, mimeType };
    } catch (err) {
      this.logger.warn(`downloadAttachment ${url}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async handleCommentChange(account: SocialAccount, platform: 'facebook' | 'instagram', change: MetaChangeEvent): Promise<void> {
    const value = change.value as {
      item?: string; // 'comment' | 'status' | ...
      verb?: string; // 'add' | 'edited' | 'remove'
      comment_id?: string;
      parent_id?: string;
      post_id?: string;
      message?: string;
      text?: string;
      from?: { id: string; name?: string; username?: string };
      created_time?: number;
      permalink_url?: string;
    };

    if (change.field === 'feed' && value.item !== 'comment') return;
    if (value.verb && value.verb !== 'add' && value.verb !== 'edited') return;

    const externalId = value.comment_id;
    const body = value.message ?? value.text;
    if (!externalId || body === undefined) return;

    await this.ingest.upsertComment({
      tenantId: account.tenantId,
      accountId: account.id,
      platform,
      kind: change.field === 'mentions' ? 'mention' : 'comment',
      externalId,
      externalParentId: value.parent_id && value.parent_id !== value.post_id ? value.parent_id : null,
      externalPostId: value.post_id ?? null,
      authorName: value.from?.name ?? value.from?.username ?? 'Desconocido',
      authorHandle: value.from?.username ?? null,
      authorExternalId: value.from?.id ?? null,
      body,
      permalink: value.permalink_url ?? null,
      fromUs: value.from?.id === account.platformAccountId,
      platformCreatedAt: value.created_time ? new Date(value.created_time * 1000) : new Date(),
    });

    await this.realtime.emit(account.tenantId, 'social:comment', { accountId: account.id });
  }

  // ─── WhatsApp Cloud ───────────────────────────────────────────────────

  private async handleWhatsAppEntry(entry: MetaWebhookEntry): Promise<void> {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value as {
        metadata?: { phone_number_id: string };
        messages?: WhatsAppMessage[];
        statuses?: WhatsAppStatus[];
        contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
      };
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const account = await this.prisma.socialAccount.findFirst({ where: { platform: 'whatsapp', platformAccountId: phoneNumberId } });
      if (!account) {
        this.logger.warn(`No hay SocialAccount de WhatsApp para phone_number_id=${phoneNumberId}`);
        continue;
      }

      for (const message of value.messages ?? []) {
        const contactName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null;
        await this.handleWhatsAppMessage(account, message, contactName);
      }
      for (const status of value.statuses ?? []) {
        await this.handleWhatsAppStatus(account, status);
      }
    }
  }

  private async handleWhatsAppMessage(account: SocialAccount, message: WhatsAppMessage, contactName: string | null): Promise<void> {
    let body: string | null = message.text?.body ?? null;
    let attachments: Array<{ kind: string; key: string; mimeType: string; name: string | null }> = [];

    const mediaField = message.image ?? message.video ?? message.audio ?? message.document ?? message.sticker;
    if (mediaField) {
      const copied = await this.copyWhatsAppMedia(account, mediaField.id, mediaField.mime_type);
      if (copied) {
        attachments = [
          {
            kind: message.image ? 'image' : message.video ? 'video' : message.audio ? 'audio' : message.sticker ? 'sticker' : 'file',
            key: copied.key,
            mimeType: mediaField.mime_type,
            name: 'filename' in mediaField ? ((mediaField as { filename?: string }).filename ?? null) : null,
          },
        ];
      }
    }

    await this.recordAndNotify({
      tenantId: account.tenantId,
      channel: 'whatsapp',
      provider: 'meta',
      senderKind: 'social_account',
      senderKey: account.id,
      socialAccountId: account.id,
      contactExternalId: message.from,
      contactPhone: `+${message.from}`,
      contactName,
      direction: 'inbound',
      body,
      attachments: attachments.length > 0 ? attachments : undefined,
      status: 'received',
      externalId: message.id,
      platformCreatedAt: new Date(Number(message.timestamp) * 1000),
    });
  }

  private async handleWhatsAppStatus(account: SocialAccount, status: WhatsAppStatus): Promise<void> {
    // Status-only event: no body/attachments of our own — preserve what's already on the row instead of wiping it via the upsert.
    const existing = await this.prisma.inboxMessage.findUnique({
      where: { channel_externalId: { channel: 'whatsapp', externalId: status.id } },
      select: { body: true, attachments: true, conversationId: true, conversation: { select: { contactExternalId: true } } },
    });
    if (!existing) return; // status for a message we never saw the send-confirmation for yet — safe to drop, the next poll/webhook will settle it

    const mappedStatus = status.status === 'read' ? 'read' : status.status === 'delivered' ? 'delivered' : status.status === 'failed' ? 'failed' : 'sent';

    await this.recordAndNotify({
      tenantId: account.tenantId,
      channel: 'whatsapp',
      provider: 'meta',
      senderKind: 'social_account',
      senderKey: account.id,
      socialAccountId: account.id,
      contactExternalId: existing.conversation.contactExternalId,
      direction: 'outbound',
      body: existing.body,
      attachments: (existing.attachments as unknown as Prisma.InputJsonValue) ?? undefined,
      status: mappedStatus,
      error: status.errors?.[0]?.title ?? null,
      externalId: status.id,
      deliveredAt: mappedStatus === 'delivered' || mappedStatus === 'read' ? new Date(Number(status.timestamp) * 1000) : null,
      readAt: mappedStatus === 'read' ? new Date(Number(status.timestamp) * 1000) : null,
      platformCreatedAt: new Date(Number(status.timestamp) * 1000),
    });
  }

  /** WhatsApp media has no public URL — `GET /{media-id}` for a short-lived authenticated URL, then downloads it with our token and copies it into the private bucket. */
  private async copyWhatsAppMedia(account: SocialAccount, mediaId: string, mimeType: string): Promise<{ key: string } | null> {
    try {
      const accessToken = await this.tokens.getAccessToken(account);
      const metaRes = await fetch(graphUrl(`/${mediaId}`), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!metaRes.ok) throw new Error(`media lookup status ${metaRes.status}`);
      const meta = (await metaRes.json()) as { url: string };

      const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!fileRes.ok) throw new Error(`media download status ${fileRes.status}`);
      const buffer = Buffer.from(await fileRes.arrayBuffer());

      const { key } = await this.s3.uploadBuffer(buffer, `${MEDIA_UPLOAD_FOLDER}/${account.tenantId}`, extensionFromMime(mimeType), mimeType);
      return { key };
    } catch (err) {
      this.logger.warn(`copyWhatsAppMedia ${mediaId}: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── shared ───────────────────────────────────────────────────────────

  private async recordAndNotify(input: NormalizedInboxMessage): Promise<void> {
    const { conversation, becameUnread } = await this.ingest.recordInboxMessage(input);

    await this.realtime.emit(input.tenantId, 'inbox:message', { conversationId: conversation.id });
    await this.realtime.emit(input.tenantId, 'inbox:conversation', { conversationId: conversation.id });

    if (becameUnread) {
      await this.notifier.notify(input.tenantId, 'SOCIAL_MESSAGE_RECEIVED', {
        title: 'Nuevo mensaje',
        message: conversation.contactName || conversation.contactHandle || 'Mensaje entrante',
        actionUrl: `/dashboard/inbox?conversation=${conversation.id}`,
        entityId: conversation.id,
      });
    }
  }
}
