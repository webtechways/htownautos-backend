import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { TwilioService } from '../twilio/twilio.service';
import { SmsEventsService, SmsEvent } from '../presence/sms-events.service';
import { CreateSmsDto, UpdateSmsDto, SmsStatus, SmsDirection } from './dto/create-sms.dto';
import { SendSmsDto } from './dto/send-sms.dto';
import { QuerySmsDto } from './dto/query-sms.dto';
import { Prisma } from '@prisma/client';
import { normalizePhoneNumber, S3Service } from '@htownautos/common';
import { SocialIngestService, SocialNotifierService, extensionFromMime, type NormalizedInboxMessage } from '@htownautos/social';

const MMS_UPLOAD_FOLDER = 'sms-mms';
const DEFAULT_MMS_MIME_TYPE = 'application/octet-stream';

interface CopiedMmsMedia {
  key: string;
  mimeType: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => TwilioService))
    private twilioService: TwilioService,
    private smsEventsService: SmsEventsService,
    private readonly s3: S3Service,
    private readonly ingest: SocialIngestService,
    private readonly notifier: SocialNotifierService,
  ) {}

  private readonly includeRelations = {
    sender: {
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
    },
    buyer: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneMain: true,
        phoneMobile: true,
      },
    },
  };

  /**
   * Convert a SmsMessage record to an SmsEvent for WebSocket emission
   */
  private toSmsEvent(sms: any): SmsEvent {
    return {
      id: sms.id,
      tenantId: sms.tenantId,
      direction: sms.direction,
      status: sms.status,
      fromNumber: sms.fromNumber,
      toNumber: sms.toNumber,
      body: sms.body,
      messageSid: sms.messageSid,
      errorCode: sms.errorCode,
      errorMessage: sms.errorMessage,
      mediaUrls: sms.mediaUrls as string[] | null,
      numMedia: sms.numMedia,
      isRead: sms.isRead,
      buyerId: sms.buyerId,
      senderId: sms.senderId,
      sentAt: sms.sentAt?.toISOString() || null,
      deliveredAt: sms.deliveredAt?.toISOString() || null,
      createdAt: sms.createdAt?.toISOString() || new Date().toISOString(),
      sender: sms.sender
        ? {
            id: sms.sender.id,
            user: {
              id: sms.sender.user.id,
              firstName: sms.sender.user.firstName,
              lastName: sms.sender.user.lastName,
              email: sms.sender.user.email,
            },
          }
        : null,
      buyer: sms.buyer
        ? {
            id: sms.buyer.id,
            firstName: sms.buyer.firstName,
            lastName: sms.buyer.lastName,
            phoneMain: sms.buyer.phoneMain,
            phoneMobile: sms.buyer.phoneMobile,
          }
        : null,
    };
  }

  /**
   * Mirrors an `SmsMessage` row into the unified inbox (`InboxConversation`/`InboxMessage`)
   * via `SocialIngestService.recordInboxMessage` — best-effort, never throws (an inbox
   * mirroring failure must not break sending/receiving the actual SMS). Notifies
   * `SOCIAL_MESSAGE_RECEIVED` only on the 0→1 unread transition (contract §3.7).
   */
  private async mirrorToInbox(input: NormalizedInboxMessage): Promise<void> {
    try {
      const { conversation, becameUnread } = await this.ingest.recordInboxMessage(input);
      if (becameUnread) {
        await this.notifier.notify(input.tenantId, 'SOCIAL_MESSAGE_RECEIVED', {
          title: 'Nuevo mensaje',
          message: input.contactName || input.contactPhone || 'Mensaje entrante',
          actionUrl: `/dashboard/inbox?conversation=${conversation.id}`,
          entityId: conversation.id,
        });
      }
    } catch (err) {
      this.logger.warn(`mirrorToInbox: ${(err as Error).message}`);
    }
  }

  private attachmentKindFor(mimeType: string): 'image' | 'video' | 'audio' | 'file' {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'file';
  }

  /**
   * Downloads every `MediaUrl<n>` Twilio sent (Basic Auth with the account
   * SID/auth token — Twilio media URLs 404 without it) and copies it into
   * the private bucket, `sms-mms/<tenantId>/...`. Best-effort per item: one
   * failed attachment must not drop the rest of the message.
   */
  private async copyMmsMedia(
    tenantId: string,
    payload: Record<string, string | undefined>,
    numMedia: number,
  ): Promise<CopiedMmsMedia[]> {
    if (numMedia <= 0) return [];

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      this.logger.warn('No se puede copiar MMS: falta TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN');
      return [];
    }
    const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const results: CopiedMmsMedia[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = payload[`MediaUrl${i}`];
      const mimeType = payload[`MediaContentType${i}`] || DEFAULT_MMS_MIME_TYPE;
      if (!url) continue;
      try {
        const res = await fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const { key } = await this.s3.uploadBuffer(buffer, `${MMS_UPLOAD_FOLDER}/${tenantId}`, extensionFromMime(mimeType), mimeType);
        results.push({ key, mimeType });
      } catch (err) {
        this.logger.warn(`No se pudo copiar media MMS ${i} (${url}): ${(err as Error).message}`);
      }
    }
    return results;
  }

  /**
   * Send an SMS via Twilio and store in database
   */
  async sendSms(tenantId: string, senderId: string, dto: SendSmsDto) {
    this.logger.log(`Sending SMS to buyer ${dto.buyerId} from tenant ${tenantId}`);

    // Get buyer info
    const buyer = await this.prisma.buyer.findFirst({
      where: { id: dto.buyerId, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneMain: true,
        phoneMobile: true,
      },
    });

    if (!buyer) {
      throw new NotFoundException('Buyer not found in this tenant');
    }

    // Determine which phone number to send to
    const toNumber = dto.toNumber
      ? normalizePhoneNumber(dto.toNumber)
      : normalizePhoneNumber(buyer.phoneMobile || buyer.phoneMain || '');

    if (!toNumber) {
      throw new BadRequestException('No phone number available for this buyer');
    }

    // Get the Twilio phone number to send from
    let fromPhoneNumber: { id: string; phoneNumber: string; twilioSid: string } | null = null;

    if (dto.fromPhoneNumberId) {
      fromPhoneNumber = await this.prisma.twilioPhoneNumber.findFirst({
        where: { id: dto.fromPhoneNumberId, tenantId, canSms: true },
        select: { id: true, phoneNumber: true, twilioSid: true },
      });
    }

    // Fall back to primary or any SMS-enabled number
    if (!fromPhoneNumber) {
      fromPhoneNumber = await this.prisma.twilioPhoneNumber.findFirst({
        where: { tenantId, canSms: true },
        orderBy: { isPrimary: 'desc' },
        select: { id: true, phoneNumber: true, twilioSid: true },
      });
    }

    if (!fromPhoneNumber) {
      throw new BadRequestException('No SMS-enabled phone number available for this tenant');
    }

    // Build status callback URL
    const baseUrl = process.env.API_BASE_URL || 'https://api.htownautos.com';
    const statusCallback = `${baseUrl}/api/v1/twilio/sms/incoming/${tenantId}/${fromPhoneNumber.id}/status`;

    // Create the SMS record first (optimistic)
    const smsMessage = await this.prisma.smsMessage.create({
      data: {
        tenantId,
        senderId,
        buyerId: dto.buyerId,
        direction: SmsDirection.OUTBOUND,
        status: SmsStatus.QUEUED,
        phoneNumber: toNumber,
        fromNumber: fromPhoneNumber.phoneNumber,
        toNumber,
        body: dto.body,
        sentAt: new Date(),
      },
      include: this.includeRelations,
    });

    // Emit the initial event
    this.smsEventsService.emitSmsCreated(this.toSmsEvent(smsMessage));

    try {
      // Send via Twilio
      const result = await this.twilioService.sendSms({
        to: toNumber,
        body: dto.body,
        from: fromPhoneNumber.phoneNumber,
        statusCallback,
      });

      // Update with Twilio SID and status
      const updatedSms = await this.prisma.smsMessage.update({
        where: { id: smsMessage.id },
        data: {
          messageSid: result.sid,
          status: result.status === 'queued' ? SmsStatus.QUEUED : SmsStatus.SENT,
        },
        include: this.includeRelations,
      });

      this.logger.log(`SMS sent successfully: ${result.sid}`);

      // Emit updated event
      this.smsEventsService.emitSmsUpdated(this.toSmsEvent(updatedSms));

      await this.mirrorToInbox({
        tenantId,
        channel: 'sms',
        provider: 'twilio',
        senderKind: 'twilio_number',
        senderKey: fromPhoneNumber.id,
        twilioPhoneNumberId: fromPhoneNumber.id,
        contactExternalId: toNumber,
        contactPhone: toNumber,
        contactName: `${buyer.firstName} ${buyer.lastName}`.trim() || null,
        buyerId: buyer.id,
        direction: 'outbound',
        body: dto.body,
        status: updatedSms.status,
        externalId: updatedSms.messageSid,
        smsMessageId: updatedSms.id,
        sentById: senderId,
        platformCreatedAt: updatedSms.createdAt,
      });

      return updatedSms;
    } catch (error) {
      // Update with error status
      const failedSms = await this.prisma.smsMessage.update({
        where: { id: smsMessage.id },
        data: {
          status: SmsStatus.FAILED,
          errorMessage: error.message,
        },
        include: this.includeRelations,
      });

      this.logger.error(`Failed to send SMS: ${error.message}`);

      // Emit failed event
      this.smsEventsService.emitSmsUpdated(this.toSmsEvent(failedSms));

      await this.mirrorToInbox({
        tenantId,
        channel: 'sms',
        provider: 'twilio',
        senderKind: 'twilio_number',
        senderKey: fromPhoneNumber.id,
        twilioPhoneNumberId: fromPhoneNumber.id,
        contactExternalId: toNumber,
        contactPhone: toNumber,
        contactName: `${buyer.firstName} ${buyer.lastName}`.trim() || null,
        buyerId: buyer.id,
        direction: 'outbound',
        body: dto.body,
        status: SmsStatus.FAILED,
        error: error.message,
        smsMessageId: failedSms.id,
        sentById: senderId,
        platformCreatedAt: failedSms.createdAt,
      });

      throw new BadRequestException(`Failed to send SMS: ${error.message}`);
    }
  }

  /**
   * Sends an outbound SMS or WhatsApp-via-Twilio message on behalf of the
   * unified inbox (`InboxService`) — the ONLY other writer path to
   * `SmsMessage` besides `sendSms`/`handleIncomingSms` above, so the rule
   * "SmsService is the only writer of SmsMessage" still holds. Mirrors into
   * the inbox itself (with `smsMessageId` for idempotency), same as
   * `sendSms`. `mediaUrls`: signed GET URLs the inbox service already
   * resolved from `SocialMedia` rows — Twilio fetches each once.
   */
  async sendForInbox(params: {
    tenantId: string;
    senderId: string | null;
    channel: 'sms' | 'whatsapp';
    toNumber: string;
    fromPhoneNumberId: string;
    body?: string;
    buyerId?: string | null;
    mediaUrls?: string[];
    /** WhatsApp Content API template — `contentSid` is the `HX…` sid, `variables` map positionally to `{"1": ..., "2": ...}`. Mutually exclusive with `body` (the caller already enforced the 24h window before reaching here). */
    template?: { contentSid: string; variables: string[] };
  }) {
    const fromPhoneNumber = await this.prisma.twilioPhoneNumber.findFirst({
      where: { id: params.fromPhoneNumberId, tenantId: params.tenantId, canSms: true },
      select: { id: true, phoneNumber: true },
    });
    if (!fromPhoneNumber) {
      throw new NotFoundException('Número de Twilio no encontrado para este tenant');
    }

    const baseUrl = process.env.PUBLIC_API_URL || process.env.API_BASE_URL || 'https://api.htownautos.com';
    const statusCallback = `${baseUrl}/api/v1/twilio/sms/incoming/${params.tenantId}/${fromPhoneNumber.id}/status`;

    const smsMessage = await this.prisma.smsMessage.create({
      data: {
        tenantId: params.tenantId,
        senderId: params.senderId ?? undefined,
        buyerId: params.buyerId ?? null,
        direction: SmsDirection.OUTBOUND,
        status: SmsStatus.QUEUED,
        phoneNumber: params.toNumber,
        fromNumber: fromPhoneNumber.phoneNumber,
        toNumber: params.toNumber,
        body: params.body ?? (params.template ? `[Plantilla ${params.template.contentSid}]` : ''),
        sentAt: new Date(),
      },
      include: this.includeRelations,
    });
    this.smsEventsService.emitSmsCreated(this.toSmsEvent(smsMessage));

    const to = params.channel === 'whatsapp' ? `whatsapp:${params.toNumber}` : params.toNumber;
    const from = params.channel === 'whatsapp' ? `whatsapp:${fromPhoneNumber.phoneNumber}` : fromPhoneNumber.phoneNumber;

    const contentVariables = params.template
      ? JSON.stringify(Object.fromEntries(params.template.variables.map((v, i) => [String(i + 1), v])))
      : undefined;

    try {
      const result = await this.twilioService.sendSms({
        to,
        from,
        statusCallback,
        mediaUrl: params.mediaUrls,
        ...(params.template
          ? { contentSid: params.template.contentSid, contentVariables }
          : { body: params.body ?? '' }),
      });

      const updated = await this.prisma.smsMessage.update({
        where: { id: smsMessage.id },
        data: { messageSid: result.sid, status: result.status === 'queued' ? SmsStatus.QUEUED : SmsStatus.SENT },
        include: this.includeRelations,
      });
      this.smsEventsService.emitSmsUpdated(this.toSmsEvent(updated));

      await this.mirrorToInbox({
        tenantId: params.tenantId,
        channel: params.channel,
        provider: 'twilio',
        senderKind: 'twilio_number',
        senderKey: fromPhoneNumber.id,
        twilioPhoneNumberId: fromPhoneNumber.id,
        contactExternalId: params.toNumber,
        contactPhone: params.toNumber,
        buyerId: params.buyerId ?? null,
        direction: 'outbound',
        body: params.body || null,
        status: updated.status,
        externalId: updated.messageSid,
        smsMessageId: updated.id,
        sentById: params.senderId ?? undefined,
        platformCreatedAt: updated.createdAt,
      });

      return updated;
    } catch (error) {
      const failed = await this.prisma.smsMessage.update({
        where: { id: smsMessage.id },
        data: { status: SmsStatus.FAILED, errorMessage: (error as Error).message },
        include: this.includeRelations,
      });
      this.smsEventsService.emitSmsUpdated(this.toSmsEvent(failed));

      await this.mirrorToInbox({
        tenantId: params.tenantId,
        channel: params.channel,
        provider: 'twilio',
        senderKind: 'twilio_number',
        senderKey: fromPhoneNumber.id,
        twilioPhoneNumberId: fromPhoneNumber.id,
        contactExternalId: params.toNumber,
        contactPhone: params.toNumber,
        buyerId: params.buyerId ?? null,
        direction: 'outbound',
        body: params.body || null,
        status: SmsStatus.FAILED,
        error: (error as Error).message,
        smsMessageId: failed.id,
        sentById: params.senderId ?? undefined,
        platformCreatedAt: failed.createdAt,
      });

      throw new BadRequestException(`No se pudo enviar el mensaje: ${(error as Error).message}`);
    }
  }

  /**
   * Handle incoming SMS/MMS/WhatsApp-via-Twilio from Twilio's webhook.
   * Every inbound message is stored, known buyer or not (§3.7 of
   * docs/social-suite/CONTRACT.md) — an unlinked number just means
   * `buyerId: null` until someone links it from the inbox. `From`/`To`
   * prefixed `whatsapp:` route this to the `whatsapp` inbox channel instead
   * of `sms`, still through this same Twilio number.
   */
  async handleIncomingSms(
    tenantId: string,
    phoneNumberId: string,
    payload: {
      MessageSid: string;
      From: string;
      To: string;
      Body: string;
      NumMedia?: string;
      NumSegments?: string;
      [key: string]: string | undefined;
    },
  ) {
    this.logger.log(`Handling incoming SMS for tenant ${tenantId}: ${payload.MessageSid}`);

    const isWhatsApp = payload.From?.startsWith('whatsapp:') ?? false;
    const rawFrom = isWhatsApp ? payload.From.replace(/^whatsapp:/, '') : payload.From;
    const rawTo = isWhatsApp ? payload.To.replace(/^whatsapp:/, '') : payload.To;
    const fromNumber = normalizePhoneNumber(rawFrom) || rawFrom;
    const toNumber = normalizePhoneNumber(rawTo) || rawTo;

    // Try to find a buyer with this phone number — unknown numbers stay unlinked, not dropped.
    const buyer = await this.findBuyerByPhone(tenantId, fromNumber);
    if (!buyer) {
      this.logger.warn(`No buyer found for phone ${fromNumber} in tenant ${tenantId} — storing unlinked`);
    }

    const numMedia = parseInt(payload.NumMedia || '0', 10);
    const media = await this.copyMmsMedia(tenantId, payload, numMedia);

    // Create the SMS message
    const smsMessage = await this.prisma.smsMessage.create({
      data: {
        tenantId,
        buyerId: buyer?.id ?? null,
        direction: SmsDirection.INBOUND,
        status: SmsStatus.RECEIVED,
        phoneNumber: fromNumber,
        fromNumber,
        toNumber,
        body: payload.Body,
        messageSid: payload.MessageSid,
        numMedia,
        segmentCount: parseInt(payload.NumSegments || '1', 10),
        mediaUrls: media.length > 0 ? media.map((m) => m.key) : undefined,
        isRead: false,
      },
      include: this.includeRelations,
    });

    this.logger.log(`Incoming SMS stored: ${smsMessage.id}`);

    // Emit real-time event
    this.smsEventsService.emitSmsCreated(this.toSmsEvent(smsMessage));

    await this.mirrorToInbox({
      tenantId,
      channel: isWhatsApp ? 'whatsapp' : 'sms',
      provider: 'twilio',
      senderKind: 'twilio_number',
      senderKey: phoneNumberId,
      twilioPhoneNumberId: phoneNumberId,
      contactExternalId: fromNumber,
      contactPhone: fromNumber,
      contactName: buyer ? `${buyer.firstName} ${buyer.lastName}`.trim() || null : null,
      buyerId: buyer?.id ?? null,
      direction: 'inbound',
      body: payload.Body || null,
      attachments: media.map((m) => ({ kind: this.attachmentKindFor(m.mimeType), key: m.key, mimeType: m.mimeType, name: null })),
      status: 'received',
      externalId: payload.MessageSid,
      smsMessageId: smsMessage.id,
      platformCreatedAt: smsMessage.createdAt,
    });

    return smsMessage;
  }

  /**
   * Handle SMS status callback from Twilio
   */
  async handleSmsStatusUpdate(
    tenantId: string,
    payload: {
      MessageSid: string;
      MessageStatus: string;
      ErrorCode?: string;
      ErrorMessage?: string;
    },
  ) {
    this.logger.log(`SMS status update: ${payload.MessageSid} -> ${payload.MessageStatus}`);

    // Find the message by SID
    const smsMessage = await this.prisma.smsMessage.findFirst({
      where: { messageSid: payload.MessageSid, tenantId },
    });

    if (!smsMessage) {
      this.logger.warn(`SMS message not found for SID: ${payload.MessageSid}`);
      return null;
    }

    // Map Twilio status to our status
    let status = smsMessage.status;
    switch (payload.MessageStatus) {
      case 'queued':
        status = SmsStatus.QUEUED;
        break;
      case 'sent':
        status = SmsStatus.SENT;
        break;
      case 'delivered':
        status = SmsStatus.DELIVERED;
        break;
      case 'failed':
      case 'undelivered':
        status = SmsStatus.FAILED;
        break;
    }

    // Update the message
    const updated = await this.prisma.smsMessage.update({
      where: { id: smsMessage.id },
      data: {
        status,
        deliveredAt: payload.MessageStatus === 'delivered' ? new Date() : smsMessage.deliveredAt,
        errorCode: payload.ErrorCode || smsMessage.errorCode,
        errorMessage: payload.ErrorMessage || smsMessage.errorMessage,
      },
      include: this.includeRelations,
    });

    // Emit event
    this.smsEventsService.emitSmsUpdated(this.toSmsEvent(updated));

    // Mirror the status change into the inbox message this SMS is linked to (idempotent on
    // smsMessageId — updates, doesn't duplicate). Reuses the existing InboxMessage's own
    // channel/conversation instead of reconstructing it, so an SMS vs. WhatsApp-via-Twilio
    // outbound message (created by `sendSms` or `InboxService`) can never land in the wrong
    // conversation because of a mismatched `channel`/`senderKey` guess here.
    if (updated.direction === SmsDirection.OUTBOUND) {
      const existingInboxMessage = await this.prisma.inboxMessage.findUnique({
        where: { smsMessageId: updated.id },
        select: { channel: true, conversation: { select: { provider: true, senderKey: true, contactExternalId: true } } },
      });
      if (existingInboxMessage) {
        await this.mirrorToInbox({
          tenantId,
          channel: existingInboxMessage.channel,
          provider: existingInboxMessage.conversation.provider,
          senderKind: 'twilio_number',
          senderKey: existingInboxMessage.conversation.senderKey,
          contactExternalId: existingInboxMessage.conversation.contactExternalId,
          buyerId: updated.buyerId,
          direction: 'outbound',
          body: updated.body,
          status: updated.status,
          error: updated.errorMessage,
          externalId: updated.messageSid,
          smsMessageId: updated.id,
          sentById: updated.senderId,
          platformCreatedAt: updated.createdAt,
          deliveredAt: updated.deliveredAt,
        });
      }
    }

    return updated;
  }

  /**
   * Find buyer by phone number
   */
  private async findBuyerByPhone(tenantId: string, phoneNumber: string) {
    const normalized = normalizePhoneNumber(phoneNumber) || phoneNumber;
    const digits = normalized.replace(/\D/g, '');

    // Try exact match first
    let buyer = await this.prisma.buyer.findFirst({
      where: {
        tenantId,
        OR: [
          { phoneMain: normalized },
          { phoneMobile: normalized },
          { phoneSecondary: normalized },
        ],
      },
    });

    // Try with just digits
    if (!buyer && digits.length >= 10) {
      const lastTen = digits.slice(-10);
      buyer = await this.prisma.buyer.findFirst({
        where: {
          tenantId,
          OR: [
            { phoneMain: { contains: lastTen } },
            { phoneMobile: { contains: lastTen } },
            { phoneSecondary: { contains: lastTen } },
          ],
        },
      });
    }

    return buyer;
  }

  // ============ Existing CRUD methods with real-time events ============

  async create(tenantId: string, createSmsDto: CreateSmsDto, senderId?: string) {
    const buyer = await this.prisma.buyer.findFirst({
      where: { id: createSmsDto.buyerId, tenantId },
    });

    if (!buyer) {
      throw new NotFoundException('Buyer not found in this tenant');
    }

    const smsMessage = await this.prisma.smsMessage.create({
      data: {
        tenantId,
        senderId,
        buyerId: createSmsDto.buyerId,
        direction: createSmsDto.direction,
        status: createSmsDto.status || SmsStatus.SENT,
        phoneNumber: createSmsDto.phoneNumber,
        fromNumber: createSmsDto.fromNumber,
        toNumber: createSmsDto.toNumber,
        body: createSmsDto.body,
        messageSid: createSmsDto.messageSid,
        errorCode: createSmsDto.errorCode,
        errorMessage: createSmsDto.errorMessage,
        mediaUrls: createSmsDto.mediaUrls,
        numMedia: createSmsDto.numMedia || 0,
        price: createSmsDto.price,
        priceUnit: createSmsDto.priceUnit,
        segmentCount: createSmsDto.segmentCount || 1,
        isRead: createSmsDto.isRead || false,
        sentAt: createSmsDto.sentAt ? new Date(createSmsDto.sentAt) : null,
        deliveredAt: createSmsDto.deliveredAt ? new Date(createSmsDto.deliveredAt) : null,
      },
      include: this.includeRelations,
    });

    // Emit event
    this.smsEventsService.emitSmsCreated(this.toSmsEvent(smsMessage));

    return smsMessage;
  }

  async findAll(tenantId: string, query: QuerySmsDto) {
    const {
      buyerId,
      senderId,
      direction,
      status,
      isRead,
      fromDate,
      toDate,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.SmsMessageWhereInput = { tenantId };

    if (buyerId) where.buyerId = buyerId;
    if (senderId) where.senderId = senderId;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (isRead !== undefined) where.isRead = isRead;

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.smsMessage.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: this.includeRelations,
      }),
      this.prisma.smsMessage.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    const smsMessage = await this.prisma.smsMessage.findFirst({
      where: { id, tenantId },
      include: this.includeRelations,
    });

    if (!smsMessage) {
      throw new NotFoundException('SMS message not found');
    }

    return smsMessage;
  }

  async update(tenantId: string, id: string, updateSmsDto: UpdateSmsDto) {
    await this.findOne(tenantId, id);

    const data: Prisma.SmsMessageUpdateInput = {};

    if (updateSmsDto.direction !== undefined) data.direction = updateSmsDto.direction;
    if (updateSmsDto.status !== undefined) data.status = updateSmsDto.status;
    if (updateSmsDto.phoneNumber !== undefined) data.phoneNumber = updateSmsDto.phoneNumber;
    if (updateSmsDto.fromNumber !== undefined) data.fromNumber = updateSmsDto.fromNumber;
    if (updateSmsDto.toNumber !== undefined) data.toNumber = updateSmsDto.toNumber;
    if (updateSmsDto.body !== undefined) data.body = updateSmsDto.body;
    if (updateSmsDto.messageSid !== undefined) data.messageSid = updateSmsDto.messageSid;
    if (updateSmsDto.errorCode !== undefined) data.errorCode = updateSmsDto.errorCode;
    if (updateSmsDto.errorMessage !== undefined) data.errorMessage = updateSmsDto.errorMessage;
    if (updateSmsDto.mediaUrls !== undefined) data.mediaUrls = updateSmsDto.mediaUrls;
    if (updateSmsDto.numMedia !== undefined) data.numMedia = updateSmsDto.numMedia;
    if (updateSmsDto.price !== undefined) data.price = updateSmsDto.price;
    if (updateSmsDto.priceUnit !== undefined) data.priceUnit = updateSmsDto.priceUnit;
    if (updateSmsDto.segmentCount !== undefined) data.segmentCount = updateSmsDto.segmentCount;
    if (updateSmsDto.isRead !== undefined) data.isRead = updateSmsDto.isRead;
    if (updateSmsDto.sentAt !== undefined) {
      data.sentAt = updateSmsDto.sentAt ? new Date(updateSmsDto.sentAt) : null;
    }
    if (updateSmsDto.deliveredAt !== undefined) {
      data.deliveredAt = updateSmsDto.deliveredAt ? new Date(updateSmsDto.deliveredAt) : null;
    }

    const updated = await this.prisma.smsMessage.update({
      where: { id },
      data,
      include: this.includeRelations,
    });

    // Emit event
    this.smsEventsService.emitSmsUpdated(this.toSmsEvent(updated));

    return updated;
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.findOne(tenantId, id);
    await this.prisma.smsMessage.delete({ where: { id } });

    return { message: 'SMS message deleted successfully' };
  }

  async findByBuyer(tenantId: string, buyerId: string, query: QuerySmsDto) {
    return this.findAll(tenantId, { ...query, buyerId });
  }

  async markAsRead(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    const updated = await this.prisma.smsMessage.update({
      where: { id },
      data: { isRead: true },
      include: this.includeRelations,
    });

    // Emit event
    this.smsEventsService.emitSmsUpdated(this.toSmsEvent(updated));

    return updated;
  }

  async markAllAsRead(tenantId: string, buyerId: string) {
    const result = await this.prisma.smsMessage.updateMany({
      where: {
        tenantId,
        buyerId,
        isRead: false,
      },
      data: { isRead: true },
    });

    return { updated: result.count };
  }

  async getConversation(tenantId: string, buyerId: string, query: QuerySmsDto) {
    return this.findAll(tenantId, {
      ...query,
      buyerId,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
  }

  async getSmsStats(tenantId: string, buyerId?: string, senderId?: string) {
    const where: Prisma.SmsMessageWhereInput = { tenantId };
    if (buyerId) where.buyerId = buyerId;
    if (senderId) where.senderId = senderId;

    const [total, sent, delivered, failed, unread] = await Promise.all([
      this.prisma.smsMessage.count({ where }),
      this.prisma.smsMessage.count({ where: { ...where, status: 'sent' } }),
      this.prisma.smsMessage.count({ where: { ...where, status: 'delivered' } }),
      this.prisma.smsMessage.count({ where: { ...where, status: { in: ['failed', 'undelivered'] } } }),
      this.prisma.smsMessage.count({ where: { ...where, isRead: false, direction: 'inbound' } }),
    ]);

    return { total, sent, delivered, failed, unread };
  }
}
