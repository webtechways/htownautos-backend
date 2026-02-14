import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreatePhoneCallDto, UpdatePhoneCallDto, CallStatus } from './dto/create-phone-call.dto';
import { QueryPhoneCallDto } from './dto/query-phone-call.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PhoneCallsService {
  constructor(private prisma: PrismaService) {}

  private readonly includeRelations = {
    caller: {
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
    createPhoneCallDto: CreatePhoneCallDto,
    callerId: string,
  ) {
    // Verify buyer exists in the tenant
    const buyer = await this.prisma.buyer.findFirst({
      where: {
        id: createPhoneCallDto.buyerId,
        tenantId,
      },
    });

    if (!buyer) {
      throw new NotFoundException('Buyer not found in this tenant');
    }

    return this.prisma.phoneCall.create({
      data: {
        tenantId,
        callerId,
        buyerId: createPhoneCallDto.buyerId,
        direction: createPhoneCallDto.direction,
        status: createPhoneCallDto.status || CallStatus.COMPLETED,
        phoneNumber: createPhoneCallDto.phoneNumber,
        startedAt: new Date(createPhoneCallDto.startedAt),
        endedAt: createPhoneCallDto.endedAt ? new Date(createPhoneCallDto.endedAt) : null,
        duration: createPhoneCallDto.duration,
        outcome: createPhoneCallDto.outcome,
        notes: createPhoneCallDto.notes,
        externalId: createPhoneCallDto.externalId,
        recordingUrl: createPhoneCallDto.recordingUrl,
        // Transcription fields
        transcription: createPhoneCallDto.transcription,
        transcriptionSid: createPhoneCallDto.transcriptionSid,
        transcriptionStatus: createPhoneCallDto.transcriptionStatus,
        // AI analysis fields
        aiSummary: createPhoneCallDto.aiSummary,
        aiSentiment: createPhoneCallDto.aiSentiment,
        aiKeyPoints: createPhoneCallDto.aiKeyPoints,
        aiNextSteps: createPhoneCallDto.aiNextSteps,
      },
      include: this.includeRelations,
    });
  }

  async findAll(tenantId: string, query: QueryPhoneCallDto) {
    const {
      buyerId,
      callerId,
      direction,
      status,
      outcome,
      fromDate,
      toDate,
      page = 1,
      limit = 20,
      sortBy = 'startedAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.PhoneCallWhereInput = {
      tenantId,
    };

    if (buyerId) where.buyerId = buyerId;
    if (callerId) where.callerId = callerId;
    if (direction) where.direction = direction;
    if (status) where.status = status;
    if (outcome) where.outcome = outcome;

    if (fromDate || toDate) {
      where.startedAt = {};
      if (fromDate) where.startedAt.gte = new Date(fromDate);
      if (toDate) where.startedAt.lte = new Date(toDate);
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.phoneCall.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: this.includeRelations,
      }),
      this.prisma.phoneCall.count({ where }),
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
    const phoneCall = await this.prisma.phoneCall.findFirst({
      where: { id, tenantId },
      include: this.includeRelations,
    });

    if (!phoneCall) {
      throw new NotFoundException('Phone call not found');
    }

    return phoneCall;
  }

  async update(tenantId: string, id: string, updatePhoneCallDto: UpdatePhoneCallDto) {
    await this.findOne(tenantId, id);

    const data: Prisma.PhoneCallUpdateInput = {};

    if (updatePhoneCallDto.direction !== undefined) data.direction = updatePhoneCallDto.direction;
    if (updatePhoneCallDto.status !== undefined) data.status = updatePhoneCallDto.status;
    if (updatePhoneCallDto.phoneNumber !== undefined) data.phoneNumber = updatePhoneCallDto.phoneNumber;
    if (updatePhoneCallDto.startedAt !== undefined) data.startedAt = new Date(updatePhoneCallDto.startedAt);
    if (updatePhoneCallDto.endedAt !== undefined) {
      data.endedAt = updatePhoneCallDto.endedAt ? new Date(updatePhoneCallDto.endedAt) : null;
    }
    if (updatePhoneCallDto.duration !== undefined) data.duration = updatePhoneCallDto.duration;
    if (updatePhoneCallDto.outcome !== undefined) data.outcome = updatePhoneCallDto.outcome;
    if (updatePhoneCallDto.notes !== undefined) data.notes = updatePhoneCallDto.notes;
    if (updatePhoneCallDto.externalId !== undefined) data.externalId = updatePhoneCallDto.externalId;
    if (updatePhoneCallDto.recordingUrl !== undefined) data.recordingUrl = updatePhoneCallDto.recordingUrl;
    // Transcription fields
    if (updatePhoneCallDto.transcription !== undefined) data.transcription = updatePhoneCallDto.transcription;
    if (updatePhoneCallDto.transcriptionSid !== undefined) data.transcriptionSid = updatePhoneCallDto.transcriptionSid;
    if (updatePhoneCallDto.transcriptionStatus !== undefined) data.transcriptionStatus = updatePhoneCallDto.transcriptionStatus;
    // AI analysis fields
    if (updatePhoneCallDto.aiSummary !== undefined) data.aiSummary = updatePhoneCallDto.aiSummary;
    if (updatePhoneCallDto.aiSentiment !== undefined) data.aiSentiment = updatePhoneCallDto.aiSentiment;
    if (updatePhoneCallDto.aiKeyPoints !== undefined) data.aiKeyPoints = updatePhoneCallDto.aiKeyPoints;
    if (updatePhoneCallDto.aiNextSteps !== undefined) data.aiNextSteps = updatePhoneCallDto.aiNextSteps;

    return this.prisma.phoneCall.update({
      where: { id },
      data,
      include: this.includeRelations,
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    await this.prisma.phoneCall.delete({ where: { id } });

    return { message: 'Phone call deleted successfully' };
  }

  async findByBuyer(tenantId: string, buyerId: string, query: QueryPhoneCallDto) {
    return this.findAll(tenantId, { ...query, buyerId });
  }

  async getCallStats(tenantId: string, buyerId?: string, callerId?: string) {
    const where: Prisma.PhoneCallWhereInput = { tenantId };
    if (buyerId) where.buyerId = buyerId;
    if (callerId) where.callerId = callerId;

    const [total, completed, missed, totalDuration] = await Promise.all([
      this.prisma.phoneCall.count({ where }),
      this.prisma.phoneCall.count({ where: { ...where, status: 'completed' } }),
      this.prisma.phoneCall.count({ where: { ...where, status: { in: ['missed', 'no_answer'] } } }),
      this.prisma.phoneCall.aggregate({
        where: { ...where, duration: { not: null } },
        _sum: { duration: true },
        _avg: { duration: true },
      }),
    ]);

    return {
      total,
      completed,
      missed,
      totalDuration: totalDuration._sum.duration || 0,
      averageDuration: Math.round(totalDuration._avg.duration || 0),
    };
  }
}
