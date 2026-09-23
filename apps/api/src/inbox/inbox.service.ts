import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type InboxConversation, type SocialAccount, type SocialMedia } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { normalizePhoneNumber } from '@htownautos/common';
import {
  MediaResolverService,
  SocialIngestService,
  SocialRealtimeService,
  SocialTokenService,
  MessagingError,
  messengerFor,
  whatsappMessenger,
  type InboxChannel,
  type InboxProvider,
  type MessagingContext,
  type WindowInfo,
} from '@htownautos/social';
import { SmsService } from '../sms/sms.service';
import { TwilioService } from '../twilio/twilio.service';
import { toAccountSummary, type AccountSummaryView } from '../social/posts/mappers';
import { toInboxConversationView, toInboxMessageView, type InboxConversationView, type InboxMessageView } from './inbox-mappers';
import type {
  ConversationListQueryDto,
  MessagePageQueryDto,
  SendMessageDto,
  StartConversationDto,
  UpdateConversationDto,
} from './dto';

/** Maps a connected `SocialAccount.platform` to the inbox channel it sends/receives DMs on — platforms with no messaging surface (threads, linkedin, tiktok, youtube, pinterest, gbp) are absent. */
const CHANNEL_FOR_PLATFORM: Partial<Record<string, InboxChannel>> = {
  facebook: 'messenger',
  instagram: 'instagram',
  whatsapp: 'whatsapp',
  x: 'x',
  bluesky: 'bluesky',
  mastodon: 'mastodon',
};

export interface InboxSenderView {
  kind: 'twilio_number' | 'social_account';
  id: string;
  label: string;
  channels: InboxChannel[];
  phoneNumber: string | null;
  account: AccountSummaryView | null;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const DEFAULT_CONVERSATION_LIMIT = 20;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_LIMIT = 100;

@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: MediaResolverService,
    private readonly tokens: SocialTokenService,
    private readonly ingest: SocialIngestService,
    private readonly realtime: SocialRealtimeService,
    private readonly smsService: SmsService,
    private readonly twilioService: TwilioService,
  ) {}

  // ─── conversations ────────────────────────────────────────────────────

  async list(tenantId: string, userId: string, query: ConversationListQueryDto): Promise<Paginated<InboxConversationView>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_CONVERSATION_LIMIT, MAX_LIMIT);

    const where: Prisma.InboxConversationWhereInput = { tenantId };
    if (query.channel) where.channel = query.channel;
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.unread) where.unreadCount = { gt: 0 };

    const and: Prisma.InboxConversationWhereInput[] = [];
    if (query.senderId) and.push({ OR: [{ socialAccountId: query.senderId }, { twilioPhoneNumberId: query.senderId }] });
    if (query.q) {
      and.push({
        OR: [
          { contactName: { contains: query.q, mode: 'insensitive' } },
          { contactHandle: { contains: query.q, mode: 'insensitive' } },
          { contactPhone: { contains: query.q, mode: 'insensitive' } },
          { lastMessagePreview: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length > 0) where.AND = and;

    if (query.assignedTo === 'unassigned') {
      where.assignedToId = null;
    } else if (query.assignedTo === 'me') {
      where.assignedToId = (await this.resolveTenantUserId(tenantId, userId)) ?? '__none__';
    } else if (query.assignedTo) {
      where.assignedToId = (await this.resolveTenantUserId(tenantId, query.assignedTo)) ?? '__none__';
    }

    const [rows, total] = await Promise.all([
      this.prisma.inboxConversation.findMany({ where, orderBy: { lastMessageAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.inboxConversation.count({ where }),
    ]);

    const data = await Promise.all(rows.map((r) => this.toView(tenantId, r)));
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getOne(tenantId: string, id: string): Promise<InboxConversationView> {
    const conversation = await this.ensureConversation(id, tenantId);
    return this.toView(tenantId, conversation);
  }

  async getMessages(tenantId: string, id: string, query: MessagePageQueryDto): Promise<{ data: InboxMessageView[]; hasMore: boolean }> {
    const conversation = await this.ensureConversation(id, tenantId);
    const limit = Math.min(query.limit ?? DEFAULT_MESSAGE_LIMIT, MAX_LIMIT);

    let cursorDate: Date | undefined;
    if (query.before) {
      const cursor = await this.prisma.inboxMessage.findFirst({ where: { id: query.before, conversationId: conversation.id }, select: { platformCreatedAt: true } });
      cursorDate = cursor?.platformCreatedAt;
    }

    const rows = await this.prisma.inboxMessage.findMany({
      where: { conversationId: conversation.id, ...(cursorDate ? { platformCreatedAt: { lt: cursorDate } } : {}) },
      orderBy: { platformCreatedAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse(); // ascending — newest last, per contract

    const sentByIds = Array.from(new Set(page.map((m) => m.sentById).filter((x): x is string => !!x)));
    const senders = sentByIds.length > 0
      ? await this.prisma.tenantUser.findMany({ where: { id: { in: sentByIds } }, include: { user: { select: { id: true, name: true, email: true, avatar: true } } } })
      : [];
    const senderById = new Map(senders.map((s) => [s.id, s]));

    const data = await Promise.all(page.map((m) => toInboxMessageView(m, this.resolver, m.sentById ? senderById.get(m.sentById) : null)));
    return { data, hasMore };
  }

  async markRead(tenantId: string, id: string): Promise<InboxConversationView> {
    const conversation = await this.ensureConversation(id, tenantId);
    const updated = await this.prisma.inboxConversation.update({ where: { id: conversation.id }, data: { unreadCount: 0 } });
    await this.realtime.emit(tenantId, 'inbox:conversation', { conversationId: updated.id });
    return this.toView(tenantId, updated);
  }

  async updateConversation(tenantId: string, id: string, dto: UpdateConversationDto): Promise<InboxConversationView> {
    const conversation = await this.ensureConversation(id, tenantId);
    const data: Prisma.InboxConversationUpdateInput = {};

    if (dto.status !== undefined) data.status = dto.status;

    if (dto.assignedToId !== undefined) {
      if (dto.assignedToId === null) {
        data.assignedTo = { disconnect: true };
      } else {
        const tenantUserId = await this.resolveTenantUserId(tenantId, dto.assignedToId);
        if (!tenantUserId) throw new NotFoundException('Usuario no encontrado en este tenant');
        data.assignedTo = { connect: { id: tenantUserId } };
      }
    }

    if (dto.buyerId !== undefined) {
      if (dto.buyerId === null) {
        data.buyer = { disconnect: true };
      } else {
        const buyer = await this.prisma.buyer.findFirst({ where: { id: dto.buyerId, tenantId } });
        if (!buyer) throw new NotFoundException('Comprador no encontrado en este tenant');
        data.buyer = { connect: { id: buyer.id } };
      }
    }

    const updated = await this.prisma.inboxConversation.update({ where: { id: conversation.id }, data });
    await this.realtime.emit(tenantId, 'inbox:conversation', { conversationId: updated.id });
    return this.toView(tenantId, updated);
  }

  // ─── send / start ─────────────────────────────────────────────────────

  async sendMessage(tenantId: string, userId: string, id: string, dto: SendMessageDto): Promise<InboxMessageView> {
    const conversation = await this.ensureConversation(id, tenantId);
    const media = await this.resolveMedia(tenantId, dto.mediaIds);
    const tenantUserId = await this.resolveTenantUserId(tenantId, userId);

    if (this.isTwilioBacked(conversation)) {
      if (!conversation.twilioPhoneNumberId) throw new NotFoundException('Conversación sin número de Twilio asociado');

      if (conversation.channel === 'whatsapp') {
        this.assertWithinWhatsAppWindow(conversation.lastInboundAt, dto.template);
      }

      const mediaUrls = await Promise.all(media.map((m) => this.resolver.signedUrl(m)));
      const sms = await this.smsService.sendForInbox({
        tenantId,
        senderId: tenantUserId,
        channel: conversation.channel as 'sms' | 'whatsapp',
        toNumber: conversation.contactPhone ?? conversation.contactExternalId,
        fromPhoneNumberId: conversation.twilioPhoneNumberId,
        body: dto.text,
        buyerId: conversation.buyerId,
        mediaUrls,
        template: dto.template ? { contentSid: dto.template.name, variables: dto.template.variables } : undefined,
      });
      return this.viewForSmsMessageId(sms.id, tenantUserId);
    }

    const messenger = messengerFor(conversation.channel as InboxChannel);
    if (!messenger) throw new UnprocessableEntityException({ code: 'NOT_SUPPORTED', message: 'Canal no soportado para enviar mensajes' });
    if (!conversation.socialAccountId) throw new NotFoundException('Conversación sin cuenta social asociada');

    const account = await this.prisma.socialAccount.findFirst({ where: { id: conversation.socialAccountId, tenantId } });
    if (!account) throw new NotFoundException('Cuenta social no encontrada');

    const ctx = await this.buildMessagingContext(tenantId, account);

    try {
      const outcome = await messenger.send({
        ctx,
        recipientExternalId: conversation.contactExternalId,
        text: dto.text,
        media,
        template: dto.template,
        lastInboundAt: conversation.lastInboundAt,
      });

      const { message } = await this.ingest.recordInboxMessage({
        tenantId,
        channel: conversation.channel,
        provider: conversation.provider,
        senderKind: 'social_account',
        senderKey: conversation.senderKey,
        socialAccountId: account.id,
        contactExternalId: conversation.contactExternalId,
        buyerId: conversation.buyerId,
        direction: 'outbound',
        body: dto.text ?? null,
        attachments: media.length > 0 ? media.map((m) => ({ kind: this.attachmentKindFor(m.mimeType), key: m.key, mimeType: m.mimeType, name: m.fileName })) : undefined,
        status: outcome.status,
        externalId: outcome.externalId,
        sentById: tenantUserId ?? undefined,
        platformCreatedAt: new Date(),
      });

      await this.realtime.emit(tenantId, 'inbox:message', { conversationId: message.conversationId });
      return toInboxMessageView(message, this.resolver, tenantUserId ? await this.loadTenantUser(tenantUserId) : null);
    } catch (err) {
      if (err instanceof MessagingError) {
        throw new UnprocessableEntityException({ code: err.code, message: err.message });
      }
      throw err;
    }
  }

  async startConversation(tenantId: string, userId: string, dto: StartConversationDto): Promise<InboxConversationView> {
    const tenantUserId = await this.resolveTenantUserId(tenantId, userId);
    const media = await this.resolveMedia(tenantId, dto.mediaIds);
    const toNumber = normalizePhoneNumber(dto.to) || dto.to;

    const phone = await this.prisma.twilioPhoneNumber.findFirst({ where: { id: dto.senderId, tenantId, canSms: true } });

    if (!phone) {
      if (dto.channel !== 'whatsapp') throw new NotFoundException('Número de Twilio no encontrado');
      const account = await this.prisma.socialAccount.findFirst({ where: { id: dto.senderId, tenantId, platform: 'whatsapp' } });
      if (!account) throw new NotFoundException('Remitente no encontrado');

      const ctx = await this.buildMessagingContext(tenantId, account);
      const messenger = messengerFor('whatsapp');
      if (!messenger) throw new UnprocessableEntityException({ code: 'NOT_SUPPORTED', message: 'WhatsApp Cloud no disponible' });

      try {
        const outcome = await messenger.send({ ctx, recipientExternalId: toNumber, text: dto.text, media, template: dto.template, lastInboundAt: null });
        const buyer = await this.findBuyerForPhone(tenantId, toNumber);
        const { conversation } = await this.ingest.recordInboxMessage({
          tenantId,
          channel: 'whatsapp',
          provider: 'meta',
          senderKind: 'social_account',
          senderKey: account.id,
          socialAccountId: account.id,
          contactExternalId: toNumber,
          contactPhone: toNumber,
          buyerId: buyer?.id ?? null,
          direction: 'outbound',
          body: dto.text ?? null,
          attachments: media.length > 0 ? media.map((m) => ({ kind: this.attachmentKindFor(m.mimeType), key: m.key, mimeType: m.mimeType, name: m.fileName })) : undefined,
          status: outcome.status,
          externalId: outcome.externalId,
          sentById: tenantUserId ?? undefined,
          platformCreatedAt: new Date(),
        });
        return this.toView(tenantId, conversation);
      } catch (err) {
        if (err instanceof MessagingError) throw new UnprocessableEntityException({ code: err.code, message: err.message });
        throw err;
      }
    }

    if (dto.channel === 'whatsapp') {
      // Brand-new conversation — no prior inbound message, so the 24h window is closed by definition; a template is always required.
      this.assertWithinWhatsAppWindow(null, dto.template);
    }

    const buyer = await this.findBuyerForPhone(tenantId, toNumber);
    const mediaUrls = await Promise.all(media.map((m) => this.resolver.signedUrl(m)));
    const sms = await this.smsService.sendForInbox({
      tenantId,
      senderId: tenantUserId,
      channel: dto.channel,
      toNumber,
      fromPhoneNumberId: phone.id,
      body: dto.text,
      buyerId: buyer?.id ?? null,
      mediaUrls,
      template: dto.template ? { contentSid: dto.template.name, variables: dto.template.variables } : undefined,
    });

    const message = await this.prisma.inboxMessage.findUnique({ where: { smsMessageId: sms.id } });
    if (!message) throw new NotFoundException('No se pudo iniciar la conversación');
    const conversation = await this.ensureConversation(message.conversationId, tenantId);
    return this.toView(tenantId, conversation);
  }

  // ─── senders / templates / unread ─────────────────────────────────────

  async unreadCount(tenantId: string): Promise<{ total: number; byChannel: Partial<Record<InboxChannel, number>> }> {
    const rows = await this.prisma.inboxConversation.groupBy({
      by: ['channel'],
      where: { tenantId, unreadCount: { gt: 0 } },
      _sum: { unreadCount: true },
    });
    const byChannel: Partial<Record<InboxChannel, number>> = {};
    let total = 0;
    for (const row of rows) {
      const n = row._sum.unreadCount ?? 0;
      byChannel[row.channel as InboxChannel] = n;
      total += n;
    }
    return { total, byChannel };
  }

  async listSenders(tenantId: string): Promise<InboxSenderView[]> {
    const [phones, accounts] = await Promise.all([
      this.prisma.twilioPhoneNumber.findMany({ where: { tenantId, isActive: true, canSms: true } }),
      this.prisma.socialAccount.findMany({ where: { tenantId, status: 'active' } }),
    ]);

    const phoneSenders: InboxSenderView[] = phones.map((p) => ({
      kind: 'twilio_number',
      id: p.id,
      label: p.friendlyName || p.phoneNumber,
      channels: ['sms', 'whatsapp'],
      phoneNumber: p.phoneNumber,
      account: null,
    }));

    const accountSenders: InboxSenderView[] = accounts
      .filter((a) => CHANNEL_FOR_PLATFORM[a.platform])
      .map((a) => ({
        kind: 'social_account',
        id: a.id,
        label: a.name,
        channels: [CHANNEL_FOR_PLATFORM[a.platform]!],
        phoneNumber: a.platform === 'whatsapp' ? a.platformAccountId : null,
        account: toAccountSummary(a),
      }));

    return [...phoneSenders, ...accountSenders];
  }

  /** `senderId` is either a WhatsApp Cloud `SocialAccount` (Meta's own template listing) or a `TwilioPhoneNumber` (Twilio Content API templates, tenant-account-wide). */
  async listWhatsAppTemplates(tenantId: string, senderId: string) {
    const account = await this.prisma.socialAccount.findFirst({ where: { id: senderId, tenantId, platform: 'whatsapp' } });
    if (account) {
      const messenger = messengerFor('whatsapp');
      if (!messenger?.listTemplates) return [];
      const ctx = await this.buildMessagingContext(tenantId, account);
      return messenger.listTemplates(ctx);
    }

    const phone = await this.prisma.twilioPhoneNumber.findFirst({ where: { id: senderId, tenantId } });
    if (!phone) throw new NotFoundException('Remitente de WhatsApp no encontrado');
    return this.twilioService.listWhatsAppContentTemplates();
  }

  async syncTwilioWebhooks(tenantId: string): Promise<{ updated: number; numbers: string[] }> {
    const phones = await this.prisma.twilioPhoneNumber.findMany({ where: { tenantId }, select: { id: true, twilioSid: true, phoneNumber: true } });
    const numbers: string[] = [];
    for (const phone of phones) {
      try {
        await this.twilioService.syncSmsWebhook(phone.twilioSid, tenantId, phone.id);
        numbers.push(phone.phoneNumber);
      } catch (err) {
        this.logger.warn(`syncTwilioWebhooks ${phone.phoneNumber}: ${(err as Error).message}`);
      }
    }
    return { updated: numbers.length, numbers };
  }

  // ─── private helpers ────────────────────────────────────────────────

  private isTwilioBacked(conversation: InboxConversation): boolean {
    return conversation.provider === 'twilio' && (conversation.channel === 'sms' || conversation.channel === 'whatsapp');
  }

  private async viewForSmsMessageId(smsMessageId: string, tenantUserId: string | null): Promise<InboxMessageView> {
    const message = await this.prisma.inboxMessage.findUnique({ where: { smsMessageId } });
    if (!message) throw new NotFoundException('No se pudo registrar el mensaje en el inbox');
    return toInboxMessageView(message, this.resolver, tenantUserId ? await this.loadTenantUser(tenantUserId) : null);
  }

  private async ensureConversation(id: string, tenantId: string): Promise<InboxConversation> {
    const row = await this.prisma.inboxConversation.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Conversación no encontrada');
    return row;
  }

  private async toView(tenantId: string, conversation: InboxConversation): Promise<InboxConversationView> {
    const [senderLabel, assignedTo, buyer] = await Promise.all([
      this.senderLabel(tenantId, conversation),
      conversation.assignedToId
        ? this.prisma.tenantUser.findUnique({ where: { id: conversation.assignedToId }, include: { user: { select: { id: true, name: true, email: true, avatar: true } } } })
        : Promise.resolve(null),
      conversation.buyerId
        ? this.prisma.buyer.findUnique({ where: { id: conversation.buyerId }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve(null),
    ]);

    const window = this.computeWindow(conversation.channel as InboxChannel, conversation.provider as InboxProvider, conversation.lastInboundAt);
    return toInboxConversationView(conversation, senderLabel, assignedTo, buyer, window);
  }

  private async senderLabel(tenantId: string, conversation: InboxConversation): Promise<string> {
    if (conversation.senderKind === 'twilio_number') {
      const phone = await this.prisma.twilioPhoneNumber.findFirst({ where: { id: conversation.senderKey, tenantId }, select: { friendlyName: true, phoneNumber: true } });
      return phone?.friendlyName || phone?.phoneNumber || conversation.senderKey;
    }
    const account = await this.prisma.socialAccount.findFirst({ where: { id: conversation.senderKey, tenantId }, select: { name: true, username: true } });
    return account?.name || account?.username || conversation.senderKey;
  }

  /** Throws the contract's 422 `TEMPLATE_REQUIRED` when the 24h WhatsApp customer-service window (Twilio or Meta, same rule) is closed and the caller didn't attach a template. */
  private assertWithinWhatsAppWindow(lastInboundAt: Date | null, template: { name: string } | undefined): void {
    const window = whatsappMessenger.windowInfo(lastInboundAt);
    if (window.replyRequiresTemplate && !template) {
      throw new UnprocessableEntityException({
        code: 'TEMPLATE_REQUIRED',
        message: 'La ventana de servicio al cliente de 24 horas cerró — se requiere una plantilla aprobada.',
      });
    }
  }

  private computeWindow(channel: InboxChannel, provider: InboxProvider, lastInboundAt: Date | null): WindowInfo {
    if (channel === 'sms') {
      return { canReply: true, windowExpiresAt: null, replyRequiresTemplate: false };
    }
    if (channel === 'whatsapp' && provider === 'twilio') {
      // Same 24h customer-service window as WhatsApp Cloud — Twilio enforces the identical Meta-side rule for WhatsApp.
      return whatsappMessenger.windowInfo(lastInboundAt);
    }
    const messenger = messengerFor(channel);
    return messenger ? messenger.windowInfo(lastInboundAt) : { canReply: false, windowExpiresAt: null, replyRequiresTemplate: false };
  }

  private async resolveTenantUserId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.prisma.tenantUser.findFirst({ where: { tenantId, userId }, select: { id: true } });
    return row?.id ?? null;
  }

  private async loadTenantUser(id: string) {
    return this.prisma.tenantUser.findUnique({ where: { id }, include: { user: { select: { id: true, name: true, email: true, avatar: true } } } });
  }

  private async resolveMedia(tenantId: string, mediaIds?: string[]): Promise<SocialMedia[]> {
    if (!mediaIds || mediaIds.length === 0) return [];
    const rows = await this.prisma.socialMedia.findMany({ where: { id: { in: mediaIds }, tenantId } });
    if (rows.length !== mediaIds.length) throw new NotFoundException('Algún medio no pertenece a este tenant');
    return rows;
  }

  private async buildMessagingContext(tenantId: string, account: SocialAccount): Promise<MessagingContext> {
    const accessToken = await this.tokens.getAccessToken(account);
    const secrets = (await this.tokens.getSecrets(account)) ?? { accessToken };
    return { tenantId, account, accessToken, secrets, resolver: this.resolver };
  }

  private async findBuyerForPhone(tenantId: string, phoneNumber: string) {
    const normalized = normalizePhoneNumber(phoneNumber) || phoneNumber;
    const digits = normalized.replace(/\D/g, '');
    let buyer = await this.prisma.buyer.findFirst({ where: { tenantId, OR: [{ phoneMain: normalized }, { phoneMobile: normalized }, { phoneSecondary: normalized }] } });
    if (!buyer && digits.length >= 10) {
      const lastTen = digits.slice(-10);
      buyer = await this.prisma.buyer.findFirst({ where: { tenantId, OR: [{ phoneMain: { contains: lastTen } }, { phoneMobile: { contains: lastTen } }, { phoneSecondary: { contains: lastTen } }] } });
    }
    return buyer;
  }

  private attachmentKindFor(mimeType: string): 'image' | 'video' | 'audio' | 'file' {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'file';
  }
}
