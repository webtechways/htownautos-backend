import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryAuditLogDto) {
    const { page = 1, limit = 20, vehicleId, buyerId, dealId, resource, action, userId, search } = query;
    const skip = (page - 1) * limit;

    const conditions: Prisma.AuditLogWhereInput[] = [];
    if (vehicleId) conditions.push({ vehicleId });
    if (buyerId) conditions.push({ buyerId });
    if (dealId) conditions.push({ dealId });
    if (resource) conditions.push({ resource });
    if (action) conditions.push({ action });
    if (userId) conditions.push({ userId });

    // Full-text search across user email, resource, action, and error message
    if (search) {
      conditions.push({
        OR: [
          { userEmail: { contains: search, mode: 'insensitive' } },
          { resource: { contains: search, mode: 'insensitive' } },
          { action: { contains: search, mode: 'insensitive' } },
          { errorMessage: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    // Exclude read/list actions by default when filtering by entity and no explicit action filter
    if (!action && (vehicleId || buyerId || dealId)) {
      conditions.push({ action: { notIn: ['read', 'list', 'list_by_entity'] } });
    }

    const where: Prisma.AuditLogWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const log = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!log) {
      throw new NotFoundException(`Audit log with ID ${id} not found`);
    }
    return log;
  }
}
