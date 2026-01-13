import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateVehicleYearDto } from './dto/create-vehicle-year.dto';
import { UpdateVehicleYearDto } from './dto/update-vehicle-year.dto';
import {
  QueryVehicleYearDto,
  YearFilterOperator,
} from './dto/query-vehicle-year.dto';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { VehicleYearEntity } from './entities/vehicle-year.entity';

@Injectable()
export class VehicleYearService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createVehicleYearDto: CreateVehicleYearDto,
  ): Promise<VehicleYearEntity> {
    // Check if year already exists
    const existing = await this.prisma.vehicleYear.findUnique({
      where: { year: createVehicleYearDto.year },
    });

    if (existing) {
      throw new ConflictException(
        `Year ${createVehicleYearDto.year} already exists`,
      );
    }

    const vehicleYear = await this.prisma.vehicleYear.create({
      data: createVehicleYearDto,
    });

    return new VehicleYearEntity(vehicleYear);
  }

  async findAll(
    query: QueryVehicleYearDto,
  ): Promise<PaginatedResponseDto<VehicleYearEntity>> {
    const { page = 1, limit = 10, year, operator, isActive } = query;

    // Build where clause
    const where: any = {};

    // Filter by isActive
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // Filter by year with operator
    if (year !== undefined) {
      switch (operator) {
        case YearFilterOperator.EQUAL:
          where.year = year;
          break;
        case YearFilterOperator.GREATER_THAN:
          where.year = { gt: year };
          break;
        case YearFilterOperator.LESS_THAN:
          where.year = { lt: year };
          break;
        case YearFilterOperator.GREATER_THAN_OR_EQUAL:
          where.year = { gte: year };
          break;
        case YearFilterOperator.LESS_THAN_OR_EQUAL:
          where.year = { lte: year };
          break;
      }
    }

    // Calculate skip
    const skip = (page - 1) * limit;

    // Execute queries in parallel
    const [data, total] = await Promise.all([
      this.prisma.vehicleYear.findMany({
        where,
        skip,
        take: limit,
        orderBy: { year: 'desc' },
      }),
      this.prisma.vehicleYear.count({ where }),
    ]);

    const entities = data.map((item) => new VehicleYearEntity(item));

    return new PaginatedResponseDto(entities, total, page, limit);
  }

  async findOne(id: string): Promise<VehicleYearEntity> {
    const vehicleYear = await this.prisma.vehicleYear.findUnique({
      where: { id },
    });

    if (!vehicleYear) {
      throw new NotFoundException(`Vehicle year with ID ${id} not found`);
    }

    return new VehicleYearEntity(vehicleYear);
  }

  async update(
    id: string,
    updateVehicleYearDto: UpdateVehicleYearDto,
  ): Promise<VehicleYearEntity> {
    // Check if exists
    await this.findOne(id);

    // If updating year, check for conflicts
    if (updateVehicleYearDto.year !== undefined) {
      const existing = await this.prisma.vehicleYear.findUnique({
        where: { year: updateVehicleYearDto.year },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Year ${updateVehicleYearDto.year} already exists`,
        );
      }
    }

    const vehicleYear = await this.prisma.vehicleYear.update({
      where: { id },
      data: updateVehicleYearDto,
    });

    return new VehicleYearEntity(vehicleYear);
  }

  async remove(id: string): Promise<{ message: string }> {
    // Check if exists
    await this.findOne(id);

    // Check if year has related makes
    const makesCount = await this.prisma.vehicleMake.count({
      where: { yearId: id },
    });

    if (makesCount > 0) {
      throw new BadRequestException(
        `Cannot delete year with ${makesCount} related makes. Delete makes first or set isActive to false instead.`,
      );
    }

    await this.prisma.vehicleYear.delete({
      where: { id },
    });

    return {
      message: `Vehicle year with ID ${id} has been successfully deleted`,
    };
  }
}
