import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateSmsDto, UpdateSmsDto, SmsStatus } from './dto/create-sms.dto';
import { QuerySmsDto } from './dto/query-sms.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class SmsService {
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
    createSmsDto: CreateSmsDto,
    senderId?: string,
  ) {
    // Verify buyer exists in the tenant
    const buyer = await this.prisma.buyer.findFirst({
      where: {
        id: createSmsDto.buyerId,
        tenantId,
      },
    });

    if (!buyer) {
      throw new NotFoundException('Buyer not found in this tenant');
    }

    return this.prisma.smsMessage.create({
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

    const where: Prisma.SmsMessageWhereInput = {
      tenantId,
    };

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

    return this.prisma.smsMessage.update({
      where: { id },
      data,
      include: this.includeRelations,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    await this.prisma.smsMessage.delete({ where: { id } });

    return { message: 'SMS message deleted successfully' };
  }

  async findByBuyer(tenantId: string, buyerId: string, query: QuerySmsDto) {
    return this.findAll(tenantId, { ...query, buyerId });
  }

  async markAsRead(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    return this.prisma.smsMessage.update({
      where: { id },
      data: { isRead: true },
      include: this.includeRelations,
    });
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
    // Get all messages between the tenant and a specific buyer
    return this.findAll(tenantId, {
      ...query,
      buyerId,
      sortBy: 'createdAt',
      sortOrder: 'asc', // Oldest first for conversation view
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

    return {
      total,
      sent,
      delivered,
      failed,
      unread,
    };
  }
}
