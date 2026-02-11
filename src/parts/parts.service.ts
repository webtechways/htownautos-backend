import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';
import {
  CreatePartDto,
  UpdatePartDto,
  QueryPartDto,
  CreatePartConditionDto,
  UpdatePartConditionDto,
  CreatePartStatusDto,
  UpdatePartStatusDto,
  CreatePartCategoryDto,
  UpdatePartCategoryDto,
} from './dto';

@Injectable()
export class PartsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a unique SKU with HTW-P- prefix
   */
  private async generateSku(tenantId: string): Promise<string> {
    const prefix = 'HTW-P-';

    // Get the highest SKU with HTW-P- prefix for this tenant
    const lastPart = await this.prisma.part.findFirst({
      where: {
        tenantId,
        sku: {
          startsWith: prefix,
        },
      },
      orderBy: {
        sku: 'desc',
      },
      select: {
        sku: true,
      },
    });

    let nextNumber = 1;
    if (lastPart?.sku) {
      const numPart = lastPart.sku.replace(prefix, '');
      const parsed = parseInt(numPart, 10);
      if (!isNaN(parsed)) {
        nextNumber = parsed + 1;
      }
    }

    // Pad with zeros to 6 digits (e.g., HTW-P-000001)
    return `${prefix}${nextNumber.toString().padStart(6, '0')}`;
  }

  // ========================================
  // PART CRUD
  // ========================================

  async create(tenantId: string, createPartDto: CreatePartDto) {
    // Validate condition exists
    const condition = await this.prisma.partCondition.findFirst({
      where: {
        id: createPartDto.conditionId,
        OR: [{ tenantId }, { tenantId: null }],
      },
    });
    if (!condition) {
      throw new NotFoundException(
        `Part condition with ID '${createPartDto.conditionId}' not found`,
      );
    }

    // Validate status exists
    const status = await this.prisma.partStatus.findFirst({
      where: {
        id: createPartDto.statusId,
        OR: [{ tenantId }, { tenantId: null }],
      },
    });
    if (!status) {
      throw new NotFoundException(
        `Part status with ID '${createPartDto.statusId}' not found`,
      );
    }

    // Validate category if provided
    if (createPartDto.categoryId) {
      const category = await this.prisma.partCategory.findFirst({
        where: {
          id: createPartDto.categoryId,
          OR: [{ tenantId }, { tenantId: null }],
        },
      });
      if (!category) {
        throw new NotFoundException(
          `Part category with ID '${createPartDto.categoryId}' not found`,
        );
      }
    }

    // Auto-generate SKU with HTW-P prefix if not provided
    const sku = createPartDto.sku || (await this.generateSku(tenantId));

    // Destructure to exclude sku from spread (to avoid undefined override)
    const { sku: _sku, purchaseDate, ...restDto } = createPartDto;

    return this.prisma.part.create({
      data: {
        tenantId,
        ...restDto,
        sku,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : undefined,
      },
      include: this.getPartIncludes(),
    });
  }

  async findAll(tenantId: string, query: QueryPartDto) {
    const {
      search,
      categoryId,
      conditionId,
      statusId,
      yearId,
      makeId,
      modelId,
      trimId,
      isOem,
      isAftermarket,
      minPrice,
      maxPrice,
      lowStock,
      location,
      supplier,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.PartWhereInput = { tenantId };

    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { partNumber: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { sourceVin: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Category filter
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // Condition filter
    if (conditionId) {
      where.conditionId = conditionId;
    }

    // Status filter
    if (statusId) {
      where.statusId = statusId;
    }

    // Vehicle compatibility filters
    if (yearId) {
      where.yearId = yearId;
    }
    if (makeId) {
      where.makeId = makeId;
    }
    if (modelId) {
      where.modelId = modelId;
    }
    if (trimId) {
      where.trimId = trimId;
    }

    // OEM/Aftermarket filters
    if (isOem !== undefined) {
      where.isOem = isOem;
    }
    if (isAftermarket !== undefined) {
      where.isAftermarket = isAftermarket;
    }

    // Price filters
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) {
        where.price.gte = minPrice;
      }
      if (maxPrice !== undefined) {
        where.price.lte = maxPrice;
      }
    }

    // Low stock filter
    if (lowStock) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        {
          quantity: {
            lte: this.prisma.part.fields.minQuantity,
          },
        },
      ];
      // Alternative approach using raw query would be better for this
      // For now, we'll filter in the query differently
      delete where.AND;
      where.quantity = { lte: 0 }; // Simplified - parts with 0 or less
    }

    // Location filter
    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }

    // Supplier filter
    if (supplier) {
      where.supplier = { contains: supplier, mode: 'insensitive' };
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.part.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: this.getPartIncludes(),
      }),
      this.prisma.part.count({ where }),
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
    const part = await this.prisma.part.findFirst({
      where: { id, tenantId },
      include: this.getPartIncludes(),
    });

    if (!part) {
      throw new NotFoundException(`Part with ID '${id}' not found`);
    }

    return part;
  }

  async update(tenantId: string, id: string, updatePartDto: UpdatePartDto) {
    await this.findOne(tenantId, id);

    // Validate condition if updating
    if (updatePartDto.conditionId) {
      const condition = await this.prisma.partCondition.findFirst({
        where: {
          id: updatePartDto.conditionId,
          OR: [{ tenantId }, { tenantId: null }],
        },
      });
      if (!condition) {
        throw new NotFoundException(
          `Part condition with ID '${updatePartDto.conditionId}' not found`,
        );
      }
    }

    // Validate status if updating
    if (updatePartDto.statusId) {
      const status = await this.prisma.partStatus.findFirst({
        where: {
          id: updatePartDto.statusId,
          OR: [{ tenantId }, { tenantId: null }],
        },
      });
      if (!status) {
        throw new NotFoundException(
          `Part status with ID '${updatePartDto.statusId}' not found`,
        );
      }
    }

    return this.prisma.part.update({
      where: { id },
      data: {
        ...updatePartDto,
        purchaseDate: updatePartDto.purchaseDate
          ? new Date(updatePartDto.purchaseDate)
          : undefined,
      },
      include: this.getPartIncludes(),
    });
  }

  async remove(tenantId: string, id: string) {
    const part = await this.findOne(tenantId, id);

    await this.prisma.part.delete({ where: { id } });

    return {
      message: `Part '${part.name}' has been successfully deleted`,
    };
  }

  async updateQuantity(
    tenantId: string,
    id: string,
    adjustment: number,
    reason?: string,
  ) {
    const part = await this.findOne(tenantId, id);

    const newQuantity = part.quantity + adjustment;
    if (newQuantity < 0) {
      throw new BadRequestException(
        `Cannot reduce quantity below 0. Current: ${part.quantity}, Adjustment: ${adjustment}`,
      );
    }

    return this.prisma.part.update({
      where: { id },
      data: { quantity: newQuantity },
      include: this.getPartIncludes(),
    });
  }

  async markAsSold(
    tenantId: string,
    id: string,
    soldData: {
      soldToId?: string;
      soldPrice?: number;
      soldDealId?: string;
    },
  ) {
    const part = await this.findOne(tenantId, id);

    // Find the "sold" status
    const soldStatus = await this.prisma.partStatus.findFirst({
      where: {
        slug: 'sold',
        OR: [{ tenantId }, { tenantId: null }],
      },
    });

    if (!soldStatus) {
      throw new NotFoundException(
        'Sold status not found. Please create a status with slug "sold".',
      );
    }

    return this.prisma.part.update({
      where: { id },
      data: {
        statusId: soldStatus.id,
        soldAt: new Date(),
        soldToId: soldData.soldToId,
        soldPrice: soldData.soldPrice,
        soldDealId: soldData.soldDealId,
        quantity: Math.max(0, part.quantity - 1),
      },
      include: this.getPartIncludes(),
    });
  }

  async getLowStockParts(tenantId: string) {
    // Get parts where quantity <= minQuantity
    const parts = await this.prisma.$queryRaw<any[]>`
      SELECT p.*,
             pc.title as condition_title,
             ps.title as status_title
      FROM parts p
      LEFT JOIN part_conditions pc ON p."conditionId" = pc.id
      LEFT JOIN part_statuses ps ON p."statusId" = ps.id
      WHERE p."tenantId" = ${tenantId}
        AND p.quantity <= p."minQuantity"
      ORDER BY p.quantity ASC
    `;

    return parts;
  }

  /**
   * Backfill SKUs for existing parts that don't have one
   */
  async backfillMissingSKUs(tenantId: string): Promise<{ updated: number }> {
    // Get all parts without SKU for this tenant
    const partsWithoutSku = await this.prisma.part.findMany({
      where: {
        tenantId,
        OR: [{ sku: null }, { sku: '' }],
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    let updated = 0;
    for (const part of partsWithoutSku) {
      const sku = await this.generateSku(tenantId);
      await this.prisma.part.update({
        where: { id: part.id },
        data: { sku },
      });
      updated++;
    }

    return { updated };
  }

  private getPartIncludes() {
    return {
      category: {
        select: { id: true, slug: true, title: true },
      },
      condition: {
        select: { id: true, slug: true, title: true },
      },
      status: {
        select: { id: true, slug: true, title: true },
      },
      year: {
        select: { id: true, year: true },
      },
      make: {
        select: { id: true, name: true, slug: true },
      },
      model: {
        select: { id: true, name: true, slug: true },
      },
      trim: {
        select: { id: true, name: true, slug: true },
      },
      sourceVehicle: {
        select: { id: true, vin: true, stockNumber: true },
      },
      mainImage: {
        select: { id: true, url: true, filename: true },
      },
    };
  }

  // ========================================
  // PART CONDITION CRUD
  // ========================================

  async createCondition(tenantId: string | null, dto: CreatePartConditionDto) {
    // Check for duplicate slug
    const existing = await this.prisma.partCondition.findFirst({
      where: { tenantId, slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(
        `Part condition with slug '${dto.slug}' already exists`,
      );
    }

    return this.prisma.partCondition.create({
      data: { ...dto, tenantId },
    });
  }

  async findAllConditions(tenantId: string) {
    return this.prisma.partCondition.findMany({
      where: {
        OR: [{ tenantId }, { tenantId: null }],
        isActive: true,
      },
      orderBy: { title: 'asc' },
    });
  }

  async updateCondition(
    tenantId: string,
    id: string,
    dto: UpdatePartConditionDto,
  ) {
    const condition = await this.prisma.partCondition.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
    });

    if (!condition) {
      throw new NotFoundException(`Part condition with ID '${id}' not found`);
    }

    // Check slug conflict if updating
    if (dto.slug && dto.slug !== condition.slug) {
      const existing = await this.prisma.partCondition.findFirst({
        where: { tenantId: condition.tenantId, slug: dto.slug },
      });
      if (existing) {
        throw new ConflictException(
          `Part condition with slug '${dto.slug}' already exists`,
        );
      }
    }

    return this.prisma.partCondition.update({
      where: { id },
      data: dto,
    });
  }

  async removeCondition(tenantId: string, id: string) {
    const condition = await this.prisma.partCondition.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
    });

    if (!condition) {
      throw new NotFoundException(`Part condition with ID '${id}' not found`);
    }

    // Check if in use
    const usageCount = await this.prisma.part.count({
      where: { conditionId: id },
    });

    if (usageCount > 0) {
      throw new BadRequestException(
        `Cannot delete condition '${condition.title}' because it is used by ${usageCount} parts`,
      );
    }

    await this.prisma.partCondition.delete({ where: { id } });

    return { message: `Part condition '${condition.title}' has been deleted` };
  }

  // ========================================
  // PART STATUS CRUD
  // ========================================

  async createStatus(tenantId: string | null, dto: CreatePartStatusDto) {
    const existing = await this.prisma.partStatus.findFirst({
      where: { tenantId, slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(
        `Part status with slug '${dto.slug}' already exists`,
      );
    }

    return this.prisma.partStatus.create({
      data: { ...dto, tenantId },
    });
  }

  async findAllStatuses(tenantId: string) {
    return this.prisma.partStatus.findMany({
      where: {
        OR: [{ tenantId }, { tenantId: null }],
        isActive: true,
      },
      orderBy: { title: 'asc' },
    });
  }

  async updateStatus(tenantId: string, id: string, dto: UpdatePartStatusDto) {
    const status = await this.prisma.partStatus.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
    });

    if (!status) {
      throw new NotFoundException(`Part status with ID '${id}' not found`);
    }

    if (dto.slug && dto.slug !== status.slug) {
      const existing = await this.prisma.partStatus.findFirst({
        where: { tenantId: status.tenantId, slug: dto.slug },
      });
      if (existing) {
        throw new ConflictException(
          `Part status with slug '${dto.slug}' already exists`,
        );
      }
    }

    return this.prisma.partStatus.update({
      where: { id },
      data: dto,
    });
  }

  async removeStatus(tenantId: string, id: string) {
    const status = await this.prisma.partStatus.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
    });

    if (!status) {
      throw new NotFoundException(`Part status with ID '${id}' not found`);
    }

    const usageCount = await this.prisma.part.count({
      where: { statusId: id },
    });

    if (usageCount > 0) {
      throw new BadRequestException(
        `Cannot delete status '${status.title}' because it is used by ${usageCount} parts`,
      );
    }

    await this.prisma.partStatus.delete({ where: { id } });

    return { message: `Part status '${status.title}' has been deleted` };
  }

  // ========================================
  // PART CATEGORY CRUD
  // ========================================

  async createCategory(tenantId: string | null, dto: CreatePartCategoryDto) {
    const existing = await this.prisma.partCategory.findFirst({
      where: { tenantId, slug: dto.slug },
    });

    if (existing) {
      throw new ConflictException(
        `Part category with slug '${dto.slug}' already exists`,
      );
    }

    // Validate parent if provided
    if (dto.parentId) {
      const parent = await this.prisma.partCategory.findFirst({
        where: { id: dto.parentId, OR: [{ tenantId }, { tenantId: null }] },
      });
      if (!parent) {
        throw new NotFoundException(
          `Parent category with ID '${dto.parentId}' not found`,
        );
      }
    }

    return this.prisma.partCategory.create({
      data: { ...dto, tenantId },
      include: {
        parent: { select: { id: true, slug: true, title: true } },
        children: { select: { id: true, slug: true, title: true } },
      },
    });
  }

  async findAllCategories(tenantId: string, includeChildren = true) {
    const categories = await this.prisma.partCategory.findMany({
      where: {
        OR: [{ tenantId }, { tenantId: null }],
        isActive: true,
        parentId: null, // Only root categories
      },
      include: includeChildren
        ? {
            children: {
              where: { isActive: true },
              include: {
                children: {
                  where: { isActive: true },
                },
              },
            },
          }
        : undefined,
      orderBy: { title: 'asc' },
    });

    return categories;
  }

  async updateCategory(
    tenantId: string,
    id: string,
    dto: UpdatePartCategoryDto,
  ) {
    const category = await this.prisma.partCategory.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
    });

    if (!category) {
      throw new NotFoundException(`Part category with ID '${id}' not found`);
    }

    if (dto.slug && dto.slug !== category.slug) {
      const existing = await this.prisma.partCategory.findFirst({
        where: { tenantId: category.tenantId, slug: dto.slug },
      });
      if (existing) {
        throw new ConflictException(
          `Part category with slug '${dto.slug}' already exists`,
        );
      }
    }

    // Prevent circular reference
    if (dto.parentId === id) {
      throw new BadRequestException('A category cannot be its own parent');
    }

    return this.prisma.partCategory.update({
      where: { id },
      data: dto,
      include: {
        parent: { select: { id: true, slug: true, title: true } },
        children: { select: { id: true, slug: true, title: true } },
      },
    });
  }

  async removeCategory(tenantId: string, id: string) {
    const category = await this.prisma.partCategory.findFirst({
      where: { id, OR: [{ tenantId }, { tenantId: null }] },
    });

    if (!category) {
      throw new NotFoundException(`Part category with ID '${id}' not found`);
    }

    // Check if has children
    const childCount = await this.prisma.partCategory.count({
      where: { parentId: id },
    });

    if (childCount > 0) {
      throw new BadRequestException(
        `Cannot delete category '${category.title}' because it has ${childCount} subcategories`,
      );
    }

    // Check if in use
    const usageCount = await this.prisma.part.count({
      where: { categoryId: id },
    });

    if (usageCount > 0) {
      throw new BadRequestException(
        `Cannot delete category '${category.title}' because it is used by ${usageCount} parts`,
      );
    }

    await this.prisma.partCategory.delete({ where: { id } });

    return { message: `Part category '${category.title}' has been deleted` };
  }
}
