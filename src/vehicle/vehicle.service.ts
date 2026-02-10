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
   * Get the default "pending" status ID
   */
  private async getDefaultStatusId(): Promise<string | undefined> {
    const pendingStatus = await this.prisma.vehicleStatus.findFirst({
      where: { slug: 'pending', tenantId: null },
    });
    return pendingStatus?.id;
  }

  /**
   * Get the default "miles" mileage unit ID
   */
  private async getDefaultMileageUnitId(): Promise<string | undefined> {
    const milesUnit = await this.prisma.mileageUnit.findFirst({
      where: { slug: 'miles' },
    });
    return milesUnit?.id;
  }

  /**
   * Generate a unique stock number with HTW prefix
   */
  private async generateStockNumber(): Promise<string> {
    const prefix = 'HTW';

    // Get the highest stock number with HTW prefix
    const lastVehicle = await this.prisma.vehicle.findFirst({
      where: {
        stockNumber: {
          startsWith: prefix,
        },
      },
      orderBy: {
        stockNumber: 'desc',
      },
      select: {
        stockNumber: true,
      },
    });

    let nextNumber = 1;
    if (lastVehicle?.stockNumber) {
      const numPart = lastVehicle.stockNumber.replace(prefix, '');
      const parsed = parseInt(numPart, 10);
      if (!isNaN(parsed)) {
        nextNumber = parsed + 1;
      }
    }

    // Pad with zeros to 6 digits (e.g., HTW000001)
    return `${prefix}${nextNumber.toString().padStart(6, '0')}`;
  }

  /**
   * Create a new vehicle
   * Validates VIN uniqueness and related entities existence
   * Creates associated metas if provided
   * Stock number is auto-generated with HTW prefix if not provided
   */
  async create(createVehicleDto: CreateVehicleDto, tenantId: string, createdById: string) {
    // Check if VIN already exists within the tenant
    const existingVin = await this.prisma.vehicle.findFirst({
      where: { vin: createVehicleDto.vin, tenantId },
    });

    if (existingVin) {
      throw new ConflictException(
        `Vehicle with VIN ${createVehicleDto.vin} already exists`,
      );
    }

    // Handle stock number: use provided (with HTW prefix) or generate new one
    let stockNumber = createVehicleDto.stockNumber?.trim() || null;
    if (stockNumber) {
      // Always ensure HTW prefix
      if (!stockNumber.startsWith('HTW')) {
        stockNumber = `HTW${stockNumber}`;
      }

      // Check if provided stock number already exists within the tenant
      const existingStock = await this.prisma.vehicle.findFirst({
        where: { stockNumber, tenantId },
      });

      if (existingStock) {
        throw new ConflictException(
          `Vehicle with stock number ${stockNumber} already exists`,
        );
      }
    } else {
      // Auto-generate stock number with HTW prefix
      stockNumber = await this.generateStockNumber();
    }

    // Validate year, make, model exist
    await this.validateRelatedEntities(createVehicleDto);

    // Set default status to "pending" if not provided
    let vehicleStatusId = createVehicleDto.vehicleStatusId;
    if (!vehicleStatusId) {
      vehicleStatusId = await this.getDefaultStatusId();
    }

    // Set default mileage unit to "miles" if not provided
    let mileageUnitId = createVehicleDto.mileageUnitId;
    if (!mileageUnitId) {
      mileageUnitId = await this.getDefaultMileageUnitId();
    }

    // Extract metas from DTO
    const { metas, stockNumber: _, ...vehicleData } = createVehicleDto;

    // Convert metaValue to JSON if it's a string
    const data: any = { ...vehicleData, stockNumber, vehicleStatusId, mileageUnitId, tenantId, createdById };
    if (typeof data.metaValue === 'string') {
      try {
        data.metaValue = JSON.parse(data.metaValue);
      } catch (error) {
        throw new BadRequestException('Invalid JSON in metaValue');
      }
    }

    // Sync legacy ↔ new pricing fields
    this.syncPricingFields(data);

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
  async findAll(query: QueryVehicleDto, tenantId: string) {
    const { page = 1, limit = 10, search, ...filters } = query;
    const skip = (page - 1) * limit;

    // Swap min/max if min > max
    if (filters.minMileage && filters.maxMileage && filters.minMileage > filters.maxMileage) {
      [filters.minMileage, filters.maxMileage] = [filters.maxMileage, filters.minMileage];
    }
    if (filters.minPrice && filters.maxPrice && filters.minPrice > filters.maxPrice) {
      [filters.minPrice, filters.maxPrice] = [filters.maxPrice, filters.minPrice];
    }

    // Build where clause
    const where: Prisma.VehicleWhereInput = {
      AND: [
        // Filter by tenant
        { tenantId },

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
        filters.titleBrandId ? { titleBrandId: filters.titleBrandId } : {},

        // Mileage range
        filters.minMileage || filters.maxMileage
          ? {
              mileage: {
                ...(filters.minMileage && { gte: filters.minMileage }),
                ...(filters.maxMileage && { lte: filters.maxMileage }),
              },
            }
          : {},

        // Price range (check askingPrice first, fallback to salePrice)
        filters.minPrice || filters.maxPrice
          ? {
              OR: [
                {
                  askingPrice: {
                    ...(filters.minPrice && { gte: filters.minPrice }),
                    ...(filters.maxPrice && { lte: filters.maxPrice }),
                  },
                },
                {
                  askingPrice: null,
                  salePrice: {
                    ...(filters.minPrice && { gte: filters.minPrice }),
                    ...(filters.maxPrice && { lte: filters.maxPrice }),
                  },
                },
              ],
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
  async findOne(id: string, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
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
  async findOneWithMetas(id: string, tenantId: string) {
    const vehicle = await this.findOne(id, tenantId);
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
  async findByVin(vin: string, tenantId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { vin, tenantId },
      include: this.getIncludeRelations(),
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with VIN ${vin} not found`);
    }

    return vehicle;
  }

  /**
   * Find one vehicle by ID for public display
   * Returns only public-safe fields (excludes cost, wholesale prices, etc.)
   */
  async findOnePublic(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
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
        mileageUnit: true,
        vehicleEngine: true,
        mainImage: {
          select: {
            id: true,
            url: true,
            filename: true,
            mimeType: true,
          },
        },
      },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle not found`);
    }

    // Get public gallery images
    const gallery = await this.prisma.media.findMany({
      where: {
        vehicleId: id,
        category: { notIn: ['receipt', 'document', 'title'] },
      },
      select: {
        id: true,
        url: true,
        filename: true,
        mimeType: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Get public metas only
    const publicMetas = await this.metaService.findByEntity(
      MetaEntityType.VEHICLE,
      id,
    ).then(metas => metas.filter(m => m.isPublic));

    // Return only public-safe fields
    return {
      id: vehicle.id,
      vin: vehicle.vin,
      stockNumber: vehicle.stockNumber,
      // Vehicle info
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      vehicleType: vehicle.vehicleType,
      bodyType: vehicle.bodyType,
      fuelType: vehicle.fuelType,
      driveType: vehicle.driveType,
      transmissionType: vehicle.transmissionType,
      vehicleCondition: vehicle.vehicleCondition,
      vehicleStatus: vehicle.vehicleStatus,
      vehicleEngine: vehicle.vehicleEngine,
      // Specs
      mileage: vehicle.mileage,
      mileageUnit: vehicle.mileageUnit,
      exteriorColor: vehicle.exteriorColor,
      interiorColor: vehicle.interiorColor,
      engine: vehicle.engine,
      cylinders: vehicle.cylinders,
      doors: vehicle.doors,
      passengers: vehicle.passengers,
      // Public pricing (asking price only, no cost or wholesale)
      askingPrice: vehicle.askingPrice,
      advertisingPrice: vehicle.advertisingPrice,
      specialPrice: vehicle.specialPrice,
      specialPriceStartDate: vehicle.specialPriceStartDate,
      specialPriceEndDate: vehicle.specialPriceEndDate,
      msrp: vehicle.msrp,
      // Description
      description: vehicle.description,
      features: vehicle.features,
      // Images
      mainImage: vehicle.mainImage,
      gallery,
      // Public metas
      metas: publicMetas,
    };
  }

  /**
   * Update a vehicle
   * Note: stockNumber, yearId, makeId, modelId, engine, cylinders, doors,
   * passengers, fuelTypeId, transmissionTypeId, driveTypeId are immutable after creation
   */
  async update(id: string, updateVehicleDto: UpdateVehicleDto, tenantId: string) {
    // Check if vehicle exists and belongs to tenant
    await this.findOne(id, tenantId);

    // If VIN is being updated, check uniqueness within tenant
    if (updateVehicleDto.vin) {
      const existingVin = await this.prisma.vehicle.findFirst({
        where: { vin: updateVehicleDto.vin, tenantId },
      });

      if (existingVin && existingVin.id !== id) {
        throw new ConflictException(
          `Vehicle with VIN ${updateVehicleDto.vin} already exists`,
        );
      }
    }

    // Remove immutable fields from update data
    const {
      stockNumber: _sn,
      yearId: _y,
      makeId: _mk,
      modelId: _md,
      engine: _e,
      cylinders: _c,
      doors: _d,
      passengers: _p,
      fuelTypeId: _ft,
      transmissionTypeId: _tt,
      driveTypeId: _dt,
      ...updateData
    } = updateVehicleDto;

    // Convert metaValue to JSON if it's a string
    const data: any = { ...updateData };
    if (typeof data.metaValue === 'string') {
      try {
        data.metaValue = JSON.parse(data.metaValue);
      } catch (error) {
        throw new BadRequestException('Invalid JSON in metaValue');
      }
    }

    // Sync legacy ↔ new pricing fields
    this.syncPricingFields(data);

    return this.prisma.vehicle.update({
      where: { id },
      data,
      include: this.getIncludeRelations(),
    });
  }

  /**
   * Delete a vehicle and all its associated metas
   */
  async remove(id: string, tenantId: string) {
    // Check if vehicle exists and belongs to tenant
    await this.findOne(id, tenantId);

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
  async getStats(tenantId: string) {
    const where = { tenantId };

    const [
      totalVehicles,
      totalValue,
      avgMileage,
      byStatus,
      byMake,
      recentVehicles,
    ] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.aggregate({
        where,
        _sum: { askingPrice: true, salePrice: true },
      }),
      this.prisma.vehicle.aggregate({
        where,
        _avg: { mileage: true },
      }),
      this.prisma.vehicle.groupBy({
        by: ['vehicleStatusId'],
        where,
        _count: true,
      }),
      this.prisma.vehicle.groupBy({
        by: ['makeId'],
        where,
        _count: true,
        orderBy: { _count: { makeId: 'desc' } },
        take: 5,
      }),
      this.prisma.vehicle.findMany({
        where,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { year: true, make: true, model: true },
      }),
    ]);

    return {
      totalVehicles,
      totalValue: totalValue._sum.askingPrice || totalValue._sum.salePrice || 0,
      avgMileage: avgMileage._avg.mileage || 0,
      byStatus,
      topMakes: byMake,
      recentVehicles,
    };
  }

  /**
   * Sync legacy pricing fields with new fields for backward compatibility
   * vehicleCost ↔ costPrice, msrp ↔ listPrice, askingPrice ↔ salePrice
   */
  private syncPricingFields(data: any) {
    // New → legacy
    if (data.vehicleCost !== undefined && data.costPrice === undefined) {
      data.costPrice = data.vehicleCost;
    }
    if (data.msrp !== undefined && data.listPrice === undefined) {
      data.listPrice = data.msrp;
    }
    if (data.askingPrice !== undefined && data.salePrice === undefined) {
      data.salePrice = data.askingPrice;
    }

    // Legacy → new
    if (data.costPrice !== undefined && data.vehicleCost === undefined) {
      data.vehicleCost = data.costPrice;
    }
    if (data.listPrice !== undefined && data.msrp === undefined) {
      data.msrp = data.listPrice;
    }
    if (data.salePrice !== undefined && data.askingPrice === undefined) {
      data.askingPrice = data.salePrice;
    }
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
      titleBrand: true,
      mileageUnit: true,
      vehicleEngine: true,
      mainImage: true,
    };
  }
}
