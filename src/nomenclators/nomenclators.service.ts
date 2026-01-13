import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateNomenclatorDto } from './dto/create-nomenclator.dto';
import { UpdateNomenclatorDto } from './dto/update-nomenclator.dto';
import { QueryNomenclatorDto } from './dto/query-nomenclator.dto';
import { NomenclatorEntity } from './entities/nomenclator.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

// Map of nomenclator types to Prisma model names
const NOMENCLATOR_MODELS: Record<string, string> = {
  'sale-types': 'saleType',
  'mileage-statuses': 'mileageStatus',
  'vehicle-statuses': 'vehicleStatus',
  'title-statuses': 'titleStatus',
  'vehicle-conditions': 'vehicleCondition',
  'brand-statuses': 'brandStatus',
  'vehicle-types': 'vehicleType',
  'body-types': 'bodyType',
  'fuel-types': 'fuelType',
  'drive-types': 'driveType',
  'transmission-types': 'transmissionType',
  'vehicle-sources': 'vehicleSource',
  'inspection-statuses': 'inspectionStatus',
  'activity-types': 'activityType',
  'activity-statuses': 'activityStatus',
  'user-roles': 'userRole',
  'lead-sources': 'leadSource',
  'inquiry-types': 'inquiryType',
  'preferred-languages': 'preferredLanguage',
  'contact-methods': 'contactMethod',
  'contact-times': 'contactTime',
  'genders': 'gender',
  'id-types': 'idType',
  'id-states': 'idState',
  'employment-statuses': 'employmentStatus',
  'occupations': 'occupation',
  'deal-statuses': 'dealStatus',
  'finance-types': 'financeType',
};

@Injectable()
export class NomenclatorsService {
  constructor(private readonly prisma: PrismaService) {}

  private getModel(type: string) {
    const modelName = NOMENCLATOR_MODELS[type];
    if (!modelName) {
      throw new BadRequestException(
        `Invalid nomenclator type: ${type}. Valid types: ${Object.keys(NOMENCLATOR_MODELS).join(', ')}`,
      );
    }
    return this.prisma.getModel(modelName);
  }

  async create(
    type: string,
    createNomenclatorDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    const model = this.getModel(type);
    const { slug, title, isActive = true } = createNomenclatorDto;

    // Check if slug already exists
    const existing = await model.findUnique({
      where: { slug },
    });

    if (existing) {
      throw new ConflictException(`${type} with slug "${slug}" already exists`);
    }

    const nomenclator = await model.create({
      data: {
        slug,
        title,
        isActive,
      },
    });

    return new NomenclatorEntity(nomenclator);
  }

  async findAll(
    type: string,
    query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    const model = this.getModel(type);
    const { page = 1, limit = 10, isActive } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by isActive
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      model.findMany({
        where,
        skip,
        take: limit,
        orderBy: { title: 'asc' },
      }),
      model.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item: any) => new NomenclatorEntity(item)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(type: string, id: string): Promise<NomenclatorEntity> {
    const model = this.getModel(type);

    const nomenclator = await model.findUnique({
      where: { id },
    });

    if (!nomenclator) {
      throw new NotFoundException(`${type} with ID ${id} not found`);
    }

    return new NomenclatorEntity(nomenclator);
  }

  async findBySlug(type: string, slug: string): Promise<NomenclatorEntity> {
    const model = this.getModel(type);

    const nomenclator = await model.findUnique({
      where: { slug },
    });

    if (!nomenclator) {
      throw new NotFoundException(`${type} with slug "${slug}" not found`);
    }

    return new NomenclatorEntity(nomenclator);
  }

  async update(
    type: string,
    id: string,
    updateNomenclatorDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    const model = this.getModel(type);

    // Verify exists
    const existing = await model.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`${type} with ID ${id} not found`);
    }

    const { slug, title, isActive } = updateNomenclatorDto;

    // Check for duplicate slug
    if (slug && slug !== existing.slug) {
      const duplicate = await model.findUnique({
        where: { slug },
      });

      if (duplicate) {
        throw new ConflictException(`${type} with slug "${slug}" already exists`);
      }
    }

    const updated = await model.update({
      where: { id },
      data: {
        ...(slug && { slug }),
        ...(title && { title }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return new NomenclatorEntity(updated);
  }

  async remove(type: string, id: string): Promise<{ message: string }> {
    const model = this.getModel(type);

    // Verify exists
    const existing = await model.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`${type} with ID ${id} not found`);
    }

    await model.delete({
      where: { id },
    });

    return {
      message: `${type} with ID ${id} has been successfully deleted`,
    };
  }

  // Get all available nomenclator types
  getAvailableTypes(): string[] {
    return Object.keys(NOMENCLATOR_MODELS);
  }
}
