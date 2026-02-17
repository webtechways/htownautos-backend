import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreatePhoneCallDto, UpdatePhoneCallDto, CallStatus } from './dto/create-phone-call.dto';
import { QueryPhoneCallDto } from './dto/query-phone-call.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PhoneCallsService {
  private readonly logger = new Logger(PhoneCallsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Check if a user can access call recordings (all roles except salesperson)
   */
  async canUserAccessRecordings(tenantId: string, userId: string): Promise<boolean> {
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      include: {
        role: { select: { slug: true } },
      },
    });
    const roleSlug = tenantUser?.role?.slug;
    // Only salesperson is restricted from accessing recordings
    return roleSlug !== undefined && roleSlug !== 'salesperson';
  }

  /**
   * Filter out recording URLs and transcriptions from call data if user is salesperson
   */
  private filterSensitiveData<T extends { recordingUrl?: string | null; transcription?: string | null }>(
    data: T[],
    canAccessRecordings: boolean,
  ): T[] {
    if (canAccessRecordings) return data;
    return data.map((call) => ({
      ...call,
      recordingUrl: null,
      transcription: null,
    }));
  }

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
    transferredTo: {
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
    transferredFrom: {
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
        fromNumber: createPhoneCallDto.fromNumber,
        toNumber: createPhoneCallDto.toNumber,
        startedAt: new Date(createPhoneCallDto.startedAt),
        endedAt: createPhoneCallDto.endedAt ? new Date(createPhoneCallDto.endedAt) : null,
        duration: createPhoneCallDto.duration,
        outcome: createPhoneCallDto.outcome,
        notes: createPhoneCallDto.notes,
        recordingUrl: createPhoneCallDto.recordingUrl,
        // Transcription fields
        transcription: createPhoneCallDto.transcription,
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

  async findAll(tenantId: string, query: QueryPhoneCallDto, canAccessRecordings = true) {
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
      data: this.filterSensitiveData(data, canAccessRecordings),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      canAccessRecordings,
    };
  }

  async findOne(tenantId: string, id: string, canAccessRecordings = true) {
    const phoneCall = await this.prisma.phoneCall.findFirst({
      where: { id, tenantId },
      include: this.includeRelations,
    });

    if (!phoneCall) {
      throw new NotFoundException('Phone call not found');
    }

    if (!canAccessRecordings) {
      return { ...phoneCall, recordingUrl: null, transcription: null };
    }

    return phoneCall;
  }

  async update(tenantId: string, id: string, updatePhoneCallDto: UpdatePhoneCallDto) {
    await this.findOne(tenantId, id);

    const data: Prisma.PhoneCallUpdateInput = {};

    if (updatePhoneCallDto.direction !== undefined) data.direction = updatePhoneCallDto.direction;
    if (updatePhoneCallDto.status !== undefined) data.status = updatePhoneCallDto.status;
    if (updatePhoneCallDto.fromNumber !== undefined) data.fromNumber = updatePhoneCallDto.fromNumber;
    if (updatePhoneCallDto.toNumber !== undefined) data.toNumber = updatePhoneCallDto.toNumber;
    if (updatePhoneCallDto.startedAt !== undefined) data.startedAt = new Date(updatePhoneCallDto.startedAt);
    if (updatePhoneCallDto.endedAt !== undefined) {
      data.endedAt = updatePhoneCallDto.endedAt ? new Date(updatePhoneCallDto.endedAt) : null;
    }
    if (updatePhoneCallDto.duration !== undefined) data.duration = updatePhoneCallDto.duration;
    if (updatePhoneCallDto.outcome !== undefined) data.outcome = updatePhoneCallDto.outcome;
    if (updatePhoneCallDto.notes !== undefined) data.notes = updatePhoneCallDto.notes;
    if (updatePhoneCallDto.recordingUrl !== undefined) data.recordingUrl = updatePhoneCallDto.recordingUrl;
    // Transcription fields
    if (updatePhoneCallDto.transcription !== undefined) data.transcription = updatePhoneCallDto.transcription;
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

  async findByBuyer(tenantId: string, buyerId: string, query: QueryPhoneCallDto, canAccessRecordings = true) {
    return this.findAll(tenantId, { ...query, buyerId }, canAccessRecordings);
  }

  /**
   * Find calls where fromNumber or toNumber matches any of the provided phone numbers
   * Used to display call history for a buyer based on their phone numbers
   */
  async findByPhoneNumbers(
    tenantId: string,
    phoneNumbers: string[],
    query: QueryPhoneCallDto,
    canAccessRecordings = true,
  ) {
    const {
      page = 1,
      limit = 20,
      sortBy = 'startedAt',
      sortOrder = 'desc',
      direction,
      status,
    } = query;

    // Normalize phone numbers to E.164 format for comparison
    const normalizedNumbers = phoneNumbers
      .filter(Boolean)
      .map((phone) => {
        // Remove all non-digit characters
        const digits = phone.replace(/\D/g, '');
        // If it's a 10-digit US number, add +1 prefix
        if (digits.length === 10) {
          return `+1${digits}`;
        }
        // If it's 11 digits starting with 1, add + prefix
        if (digits.length === 11 && digits.startsWith('1')) {
          return `+${digits}`;
        }
        // Otherwise return with + prefix if not already present
        return digits.startsWith('+') ? digits : `+${digits}`;
      });

    if (normalizedNumbers.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        canAccessRecordings,
      };
    }

    const where: Prisma.PhoneCallWhereInput = {
      tenantId,
      OR: [
        { fromNumber: { in: normalizedNumbers } },
        { toNumber: { in: normalizedNumbers } },
      ],
    };

    // Apply optional filters
    if (direction) where.direction = direction;
    if (status) where.status = status;

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
      data: this.filterSensitiveData(data, canAccessRecordings),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      canAccessRecordings,
    };
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
