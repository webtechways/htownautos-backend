import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateEmailMessageDto, UpdateEmailMessageDto, EmailStatus } from './dto/create-email-message.dto';
import { QueryEmailMessageDto } from './dto/query-email-message.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class EmailMessagesService {
  constructor(private prisma: PrismaService) {}

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

  async create(
    tenantId: string,
    createEmailMessageDto: CreateEmailMessageDto,
    senderId?: string,
  ) {
    // Verify buyer exists in the tenant
    const buyer = await this.prisma.buyer.findFirst({
      where: {
        id: createEmailMessageDto.buyerId,
        tenantId,
      },
    });

    if (!buyer) {
      throw new NotFoundException('Buyer not found in this tenant');
    }

    return this.prisma.emailMessage.create({
      data: {
        tenantId,
        senderId,
        buyerId: createEmailMessageDto.buyerId,
        direction: createEmailMessageDto.direction,
        status: createEmailMessageDto.status || EmailStatus.SENT,
        fromEmail: createEmailMessageDto.fromEmail,
        toEmail: createEmailMessageDto.toEmail,
        replyTo: createEmailMessageDto.replyTo,
        ccEmails: createEmailMessageDto.ccEmails,
        bccEmails: createEmailMessageDto.bccEmails,
        subject: createEmailMessageDto.subject,
        bodyHtml: createEmailMessageDto.bodyHtml,
        bodyText: createEmailMessageDto.bodyText,
        threadId: createEmailMessageDto.threadId,
        inReplyTo: createEmailMessageDto.inReplyTo,
        references: createEmailMessageDto.references,
        attachments: createEmailMessageDto.attachments,
        attachmentCount: createEmailMessageDto.attachmentCount || 0,
        messageId: createEmailMessageDto.messageId,
        sesStatus: createEmailMessageDto.sesStatus,
        bounceType: createEmailMessageDto.bounceType,
        bounceSubType: createEmailMessageDto.bounceSubType,
        complaintType: createEmailMessageDto.complaintType,
        isRead: createEmailMessageDto.isRead || false,
        openCount: createEmailMessageDto.openCount || 0,
        clickCount: createEmailMessageDto.clickCount || 0,
        priority: createEmailMessageDto.priority,
        labels: createEmailMessageDto.labels,
        scheduledAt: createEmailMessageDto.scheduledAt ? new Date(createEmailMessageDto.scheduledAt) : null,
        sentAt: createEmailMessageDto.sentAt ? new Date(createEmailMessageDto.sentAt) : null,
        deliveredAt: createEmailMessageDto.deliveredAt ? new Date(createEmailMessageDto.deliveredAt) : null,
        bouncedAt: createEmailMessageDto.bouncedAt ? new Date(createEmailMessageDto.bouncedAt) : null,
      },
      include: this.includeRelations,
    });
  }

  async findAll(tenantId: string, query: QueryEmailMessageDto) {
    const {
      buyerId,
      senderId,
      direction,
      status,
      priority,
      isRead,
      threadId,
      search,
      fromDate,
      toDate,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.EmailMessageWhereInput = {
      tenantId,
    };

    if (buyerId) where.buyerId = buyerId;
    if (senderId) where.senderId = senderId;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (isRead !== undefined) where.isRead = isRead;
    if (threadId) where.threadId = threadId;

    if (search) {
      where.subject = { contains: search, mode: 'insensitive' };
    }

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.emailMessage.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: this.includeRelations,
      }),
      this.prisma.emailMessage.count({ where }),
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
    const emailMessage = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId },
      include: this.includeRelations,
    });

    if (!emailMessage) {
      throw new NotFoundException('Email message not found');
    }

    return emailMessage;
  }

  async update(tenantId: string, id: string, updateEmailMessageDto: UpdateEmailMessageDto) {
    await this.findOne(tenantId, id);

    const data: Prisma.EmailMessageUpdateInput = {};

    if (updateEmailMessageDto.direction !== undefined) data.direction = updateEmailMessageDto.direction;
    if (updateEmailMessageDto.status !== undefined) data.status = updateEmailMessageDto.status;
    if (updateEmailMessageDto.fromEmail !== undefined) data.fromEmail = updateEmailMessageDto.fromEmail;
    if (updateEmailMessageDto.toEmail !== undefined) data.toEmail = updateEmailMessageDto.toEmail;
    if (updateEmailMessageDto.replyTo !== undefined) data.replyTo = updateEmailMessageDto.replyTo;
    if (updateEmailMessageDto.ccEmails !== undefined) data.ccEmails = updateEmailMessageDto.ccEmails;
    if (updateEmailMessageDto.bccEmails !== undefined) data.bccEmails = updateEmailMessageDto.bccEmails;
    if (updateEmailMessageDto.subject !== undefined) data.subject = updateEmailMessageDto.subject;
    if (updateEmailMessageDto.bodyHtml !== undefined) data.bodyHtml = updateEmailMessageDto.bodyHtml;
    if (updateEmailMessageDto.bodyText !== undefined) data.bodyText = updateEmailMessageDto.bodyText;
    if (updateEmailMessageDto.threadId !== undefined) data.threadId = updateEmailMessageDto.threadId;
    if (updateEmailMessageDto.inReplyTo !== undefined) data.inReplyTo = updateEmailMessageDto.inReplyTo;
    if (updateEmailMessageDto.references !== undefined) data.references = updateEmailMessageDto.references;
    if (updateEmailMessageDto.attachments !== undefined) data.attachments = updateEmailMessageDto.attachments;
    if (updateEmailMessageDto.attachmentCount !== undefined) data.attachmentCount = updateEmailMessageDto.attachmentCount;
    if (updateEmailMessageDto.messageId !== undefined) data.messageId = updateEmailMessageDto.messageId;
    if (updateEmailMessageDto.sesStatus !== undefined) data.sesStatus = updateEmailMessageDto.sesStatus;
    if (updateEmailMessageDto.bounceType !== undefined) data.bounceType = updateEmailMessageDto.bounceType;
    if (updateEmailMessageDto.bounceSubType !== undefined) data.bounceSubType = updateEmailMessageDto.bounceSubType;
    if (updateEmailMessageDto.complaintType !== undefined) data.complaintType = updateEmailMessageDto.complaintType;
    if (updateEmailMessageDto.isRead !== undefined) data.isRead = updateEmailMessageDto.isRead;
    if (updateEmailMessageDto.openCount !== undefined) data.openCount = updateEmailMessageDto.openCount;
    if (updateEmailMessageDto.clickCount !== undefined) data.clickCount = updateEmailMessageDto.clickCount;
    if (updateEmailMessageDto.priority !== undefined) data.priority = updateEmailMessageDto.priority;
    if (updateEmailMessageDto.labels !== undefined) data.labels = updateEmailMessageDto.labels;
    if (updateEmailMessageDto.scheduledAt !== undefined) {
      data.scheduledAt = updateEmailMessageDto.scheduledAt ? new Date(updateEmailMessageDto.scheduledAt) : null;
    }
    if (updateEmailMessageDto.sentAt !== undefined) {
      data.sentAt = updateEmailMessageDto.sentAt ? new Date(updateEmailMessageDto.sentAt) : null;
    }
    if (updateEmailMessageDto.deliveredAt !== undefined) {
      data.deliveredAt = updateEmailMessageDto.deliveredAt ? new Date(updateEmailMessageDto.deliveredAt) : null;
    }
    if (updateEmailMessageDto.bouncedAt !== undefined) {
      data.bouncedAt = updateEmailMessageDto.bouncedAt ? new Date(updateEmailMessageDto.bouncedAt) : null;
    }

    return this.prisma.emailMessage.update({
      where: { id },
      data,
      include: this.includeRelations,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    await this.prisma.emailMessage.delete({ where: { id } });

    return { message: 'Email message deleted successfully' };
  }

  async findByBuyer(tenantId: string, buyerId: string, query: QueryEmailMessageDto) {
    return this.findAll(tenantId, { ...query, buyerId });
  }

  async markAsRead(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    return this.prisma.emailMessage.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
      include: this.includeRelations,
    });
  }

  async markAllAsRead(tenantId: string, buyerId: string) {
    const result = await this.prisma.emailMessage.updateMany({
      where: {
        tenantId,
        buyerId,
        isRead: false,
      },
      data: { isRead: true, readAt: new Date() },
    });

    return { updated: result.count };
  }

  async getThread(tenantId: string, threadId: string, query: QueryEmailMessageDto) {
    return this.findAll(tenantId, {
      ...query,
      threadId,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });
  }

  async trackOpen(tenantId: string, id: string) {
    const email = await this.findOne(tenantId, id);

    return this.prisma.emailMessage.update({
      where: { id },
      data: {
        openCount: email.openCount + 1,
        lastOpenedAt: new Date(),
        status: 'opened',
      },
      include: this.includeRelations,
    });
  }

  async trackClick(tenantId: string, id: string) {
    const email = await this.findOne(tenantId, id);

    return this.prisma.emailMessage.update({
      where: { id },
      data: {
        clickCount: email.clickCount + 1,
        lastClickedAt: new Date(),
        status: 'clicked',
      },
      include: this.includeRelations,
    });
  }

  async getEmailStats(tenantId: string, buyerId?: string, senderId?: string) {
    const where: Prisma.EmailMessageWhereInput = { tenantId };
    if (buyerId) where.buyerId = buyerId;
    if (senderId) where.senderId = senderId;

    const [total, sent, delivered, opened, bounced, unread] = await Promise.all([
      this.prisma.emailMessage.count({ where }),
      this.prisma.emailMessage.count({ where: { ...where, status: 'sent' } }),
      this.prisma.emailMessage.count({ where: { ...where, status: 'delivered' } }),
      this.prisma.emailMessage.count({ where: { ...where, status: { in: ['opened', 'clicked'] } } }),
      this.prisma.emailMessage.count({ where: { ...where, status: 'bounced' } }),
      this.prisma.emailMessage.count({ where: { ...where, isRead: false, direction: 'inbound' } }),
    ]);

    return {
      total,
      sent,
      delivered,
      opened,
      bounced,
      unread,
      openRate: sent > 0 ? Math.round((opened / sent) * 100) : 0,
    };
  }
}
