import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateMetaDto } from './dto/create-meta.dto';
import { UpdateMetaDto } from './dto/update-meta.dto';
import { QueryMetaDto } from './dto/query-meta.dto';

@Injectable()
export class MetaService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new meta entry
   */
  async create(createMetaDto: CreateMetaDto) {
    // Check if meta with same entityType, entityId, and key already exists
    const existing = await this.prisma.meta.findUnique({
      where: {
        entityType_entityId_key: {
          entityType: createMetaDto.entityType,
          entityId: createMetaDto.entityId,
          key: createMetaDto.key,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Meta with key "${createMetaDto.key}" already exists for ${createMetaDto.entityType}:${createMetaDto.entityId}`,
      );
    }

    return this.prisma.meta.create({
      data: createMetaDto,
    });
  }

  /**
   * Find all metas with filters and pagination
   */
  async findAll(queryDto: QueryMetaDto) {
    const { page = 1, limit = 20, search, ...filters } = queryDto;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = {
      ...filters,
      isDeleted: false, // Never show soft-deleted records
    };

    // Add search functionality
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { value: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.meta.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.meta.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find one meta by ID
   */
  async findOne(id: string) {
    const meta = await this.prisma.meta.findUnique({
      where: { id, isDeleted: false },
    });

    if (!meta) {
      throw new NotFoundException(`Meta with ID ${id} not found`);
    }

    return meta;
  }

  /**
   * Find all metas for a specific entity
   */
  async findByEntity(entityType: string, entityId: string) {
    return this.prisma.meta.findMany({
      where: {
        entityType,
        entityId,
        isDeleted: false,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find a specific meta by entity and key
   */
  async findByEntityAndKey(entityType: string, entityId: string, key: string) {
    const meta = await this.prisma.meta.findUnique({
      where: {
        entityType_entityId_key: {
          entityType,
          entityId,
          key,
        },
        isDeleted: false,
      },
    });

    if (!meta) {
      throw new NotFoundException(
        `Meta with key "${key}" not found for ${entityType}:${entityId}`,
      );
    }

    return meta;
  }

  /**
   * Update a meta entry
   */
  async update(id: string, updateMetaDto: UpdateMetaDto) {
    // Check if meta exists and get it
    const meta = await this.findOne(id);

    // If updating key, check for conflicts
    if (updateMetaDto.key) {
      const existing = await this.prisma.meta.findFirst({
        where: {
          entityType: meta.entityType,
          entityId: meta.entityId,
          key: updateMetaDto.key,
          id: { not: id },
          isDeleted: false,
        },
      });

      if (existing) {
        throw new ConflictException(
          `Meta with key "${updateMetaDto.key}" already exists for this entity`,
        );
      }
    }

    return this.prisma.meta.update({
      where: { id },
      data: updateMetaDto,
    });
  }

  /**
   * Soft delete a meta entry
   */
  async remove(id: string) {
    // Check if meta exists
    await this.findOne(id);

    return this.prisma.meta.update({
      where: { id },
      data: {
        isDeleted: true,
        isActive: false,
      },
    });
  }

  /**
   * Hard delete a meta entry (admin only)
   */
  async hardDelete(id: string) {
    // Check if meta exists
    await this.findOne(id);

    return this.prisma.meta.delete({
      where: { id },
    });
  }

  /**
   * Bulk create metas for an entity
   */
  async bulkCreate(metas: CreateMetaDto[]) {
    // Validate no duplicates in the input
    const keys = new Set();
    for (const meta of metas) {
      const key = `${meta.entityType}:${meta.entityId}:${meta.key}`;
      if (keys.has(key)) {
        throw new BadRequestException(
          `Duplicate meta key "${meta.key}" in bulk create request`,
        );
      }
      keys.add(key);
    }

    // Create all metas
    return this.prisma.$transaction(
      metas.map((meta) =>
        this.prisma.meta.create({
          data: meta,
        }),
      ),
    );
  }

  /**
   * Delete all metas for an entity (soft delete)
   */
  async deleteByEntity(entityType: string, entityId: string) {
    return this.prisma.meta.updateMany({
      where: {
        entityType,
        entityId,
        isDeleted: false,
      },
      data: {
        isDeleted: true,
        isActive: false,
      },
    });
  }
}
