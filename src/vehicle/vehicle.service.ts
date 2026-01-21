import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MetaService } from '../meta/meta.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { QueryVehicleDto } from './dto/query-vehicle.dto';
import { Prisma } from '@prisma/client';
import { MetaEntityType, MetaValueType } from '../meta/dto/create-meta.dto';

/**
 * Vehicle Service
 * Handles all business logic for vehicle management
 * RouteOne/DealerTrack compliant
 */
@Injectable()
export class VehicleService {
  constructor(
    private prisma: PrismaService,
    private metaService: MetaService,
  ) {}

  /**
   * Create a new vehicle
   * Validates VIN uniqueness and related entities existence
   * Creates associated metas if provided
   */
  async create(createVehicleDto: CreateVehicleDto) {
    // Check if VIN already exists
    const existingVin = await this.prisma.vehicle.findUnique({
      where: { vin: createVehicleDto.vin },
    });

    if (existingVin) {
      throw new ConflictException(
        `Vehicle with VIN ${createVehicleDto.vin} already exists`,
      );
    }

    // Check if stock number already exists (if provided)
    if (createVehicleDto.stockNumber) {
      const existingStock = await this.prisma.vehicle.findUnique({
        where: { stockNumber: createVehicleDto.stockNumber },
      });

      if (existingStock) {
        throw new ConflictException(
          `Vehicle with stock number ${createVehicleDto.stockNumber} already exists`,
        );
      }
    }

    // Validate year, make, model exist
    await this.validateRelatedEntities(createVehicleDto);

    // Extract metas from DTO
    const { metas, ...vehicleData } = createVehicleDto;

    // Convert metaValue to JSON if it's a string
    const data: any = { ...vehicleData };
    if (typeof data.metaValue === 'string') {
      try {
        data.metaValue = JSON.parse(data.metaValue);
      } catch (error) {
        throw new BadRequestException('Invalid JSON in metaValue');
      }
    }

    // Create vehicle
    const vehicle = await this.prisma.vehicle.create({
      data,
      include: this.getIncludeRelations(),
    });

    // Create metas if provided
    if (metas && metas.length > 0) {
      const metaDtos = metas.map((meta) => ({
        entityType: MetaEntityType.VEHICLE,
        entityId: vehicle.id,
        key: meta.key,
        value: meta.value,
        valueType: (meta.valueType as MetaValueType) || MetaValueType.STRING,
        description: meta.description,
        isPublic: meta.isPublic || false,
      }));

      await this.metaService.bulkCreate(metaDtos);
    }

    return vehicle;
  }

  /**
   * Find all vehicles with filtering and pagination
   */
  async findAll(query: QueryVehicleDto) {
    const { page = 1, limit = 10, search, ...filters } = query;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Prisma.VehicleWhereInput = {
      AND: [
        // VIN filter (partial match)
        filters.vin
          ? { vin: { contains: filters.vin, mode: 'insensitive' } }
          : {},

        // Stock number filter (partial match)
        filters.stockNumber
          ? {
              stockNumber: {
                contains: filters.stockNumber,
                mode: 'insensitive',
              },
            }
          : {},

        // Year, Make, Model, Trim filters
        filters.yearId ? { yearId: filters.yearId } : {},
        filters.makeId ? { makeId: filters.makeId } : {},
        filters.modelId ? { modelId: filters.modelId } : {},
        filters.trimId ? { trimId: filters.trimId } : {},

        // Nomenclator filters
        filters.vehicleTypeId ? { vehicleTypeId: filters.vehicleTypeId } : {},
        filters.bodyTypeId ? { bodyTypeId: filters.bodyTypeId } : {},
        filters.fuelTypeId ? { fuelTypeId: filters.fuelTypeId } : {},
        filters.driveTypeId ? { driveTypeId: filters.driveTypeId } : {},
        filters.transmissionTypeId
          ? { transmissionTypeId: filters.transmissionTypeId }
          : {},
        filters.vehicleConditionId
          ? { vehicleConditionId: filters.vehicleConditionId }
          : {},
        filters.vehicleStatusId
          ? { vehicleStatusId: filters.vehicleStatusId }
          : {},
        filters.sourceId ? { sourceId: filters.sourceId } : {},

        // Mileage range
        filters.minMileage || filters.maxMileage
          ? {
              mileage: {
                ...(filters.minMileage && { gte: filters.minMileage }),
                ...(filters.maxMileage && { lte: filters.maxMileage }),
              },
            }
          : {},

        // Price range (using salePrice)
        filters.minPrice || filters.maxPrice
          ? {
              salePrice: {
                ...(filters.minPrice && { gte: filters.minPrice }),
                ...(filters.maxPrice && { lte: filters.maxPrice }),
              },
            }
          : {},

        // Global search across VIN, stock number, description
        search
          ? {
              OR: [
                { vin: { contains: search, mode: 'insensitive' } },
                {
                  stockNumber: { contains: search, mode: 'insensitive' },
                },
                { description: { contains: search, mode: 'insensitive' } },
                { features: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };

    // Execute queries in parallel
    const [vehicles, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        skip,
        take: limit,
        include: this.getIncludeRelations(),
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data: vehicles,
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

  /**
   * Find one vehicle by ID
   */
  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: this.getIncludeRelations(),
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }

    return vehicle;
  }

  /**
   * Find one vehicle by ID with its metas
   */
  async findOneWithMetas(id: string) {
    const vehicle = await this.findOne(id);
    const metas = await this.metaService.findByEntity(
      MetaEntityType.VEHICLE,
      id,
    );

    return {
      ...vehicle,
      metas,
    };
  }

  /**
   * Find vehicle by VIN
   */
  async findByVin(vin: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { vin },
      include: this.getIncludeRelations(),
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with VIN ${vin} not found`);
    }

    return vehicle;
  }

  /**
   * Update a vehicle
   */
  async update(id: string, updateVehicleDto: UpdateVehicleDto) {
    // Check if vehicle exists
    await this.findOne(id);

    // If VIN is being updated, check uniqueness
    if (updateVehicleDto.vin) {
      const existingVin = await this.prisma.vehicle.findUnique({
        where: { vin: updateVehicleDto.vin },
      });

      if (existingVin && existingVin.id !== id) {
        throw new ConflictException(
          `Vehicle with VIN ${updateVehicleDto.vin} already exists`,
        );
      }
    }

    // If stock number is being updated, check uniqueness
    if (updateVehicleDto.stockNumber) {
      const existingStock = await this.prisma.vehicle.findUnique({
        where: { stockNumber: updateVehicleDto.stockNumber },
      });

      if (existingStock && existingStock.id !== id) {
        throw new ConflictException(
          `Vehicle with stock number ${updateVehicleDto.stockNumber} already exists`,
        );
      }
    }

    // Convert metaValue to JSON if it's a string
    const data: any = { ...updateVehicleDto };
    if (typeof data.metaValue === 'string') {
      try {
        data.metaValue = JSON.parse(data.metaValue);
      } catch (error) {
        throw new BadRequestException('Invalid JSON in metaValue');
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data,
      include: this.getIncludeRelations(),
    });
  }

  /**
   * Delete a vehicle and all its associated metas
   */
  async remove(id: string) {
    // Check if vehicle exists
    await this.findOne(id);

    // Delete all associated metas (soft delete)
    await this.metaService.deleteByEntity(MetaEntityType.VEHICLE, id);

    // Delete the vehicle
    await this.prisma.vehicle.delete({
      where: { id },
    });

    return {
      message: `Vehicle with ID ${id} and its associated metadata have been successfully deleted`,
    };
  }

  /**
   * Get vehicle statistics
   */
  async getStats() {
    const [
      totalVehicles,
      totalValue,
      avgMileage,
      byStatus,
      byMake,
      recentVehicles,
    ] = await Promise.all([
      this.prisma.vehicle.count(),
      this.prisma.vehicle.aggregate({
        _sum: { salePrice: true },
      }),
      this.prisma.vehicle.aggregate({
        _avg: { mileage: true },
      }),
      this.prisma.vehicle.groupBy({
        by: ['vehicleStatusId'],
        _count: true,
      }),
      this.prisma.vehicle.groupBy({
        by: ['makeId'],
        _count: true,
        orderBy: { _count: { makeId: 'desc' } },
        take: 5,
      }),
      this.prisma.vehicle.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { year: true, make: true, model: true },
      }),
    ]);

    return {
      totalVehicles,
      totalValue: totalValue._sum.salePrice || 0,
      avgMileage: avgMileage._avg.mileage || 0,
      byStatus,
      topMakes: byMake,
      recentVehicles,
    };
  }

  /**
   * Validate related entities exist (year, make, model, trim if provided)
   */
  private async validateRelatedEntities(dto: CreateVehicleDto | UpdateVehicleDto) {
    const errors: string[] = [];

    if (dto.yearId) {
      const year = await this.prisma.vehicleYear.findUnique({
        where: { id: dto.yearId },
      });
      if (!year) {
        errors.push(`Year with ID ${dto.yearId} not found`);
      }
    }

    if (dto.makeId) {
      const make = await this.prisma.vehicleMake.findUnique({
        where: { id: dto.makeId },
      });
      if (!make) {
        errors.push(`Make with ID ${dto.makeId} not found`);
      }
    }

    if (dto.modelId) {
      const model = await this.prisma.vehicleModel.findUnique({
        where: { id: dto.modelId },
      });
      if (!model) {
        errors.push(`Model with ID ${dto.modelId} not found`);
      }
    }

    if (dto.trimId) {
      const trim = await this.prisma.vehicleTrim.findUnique({
        where: { id: dto.trimId },
      });
      if (!trim) {
        errors.push(`Trim with ID ${dto.trimId} not found`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException(errors.join(', '));
    }
  }

  /**
   * Get relations to include in queries
   */
  private getIncludeRelations() {
    return {
      year: true,
      make: true,
      model: true,
      trim: true,
      vehicleType: true,
      bodyType: true,
      fuelType: true,
      driveType: true,
      transmissionType: true,
      vehicleCondition: true,
      vehicleStatus: true,
      source: true,
      mainImage: true,
    };
  }
}
