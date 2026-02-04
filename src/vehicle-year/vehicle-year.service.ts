import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
  private readonly logger = new Logger(VehicleYearService.name);

  constructor(private readonly prisma: PrismaService) { }

  /**
   * Runs every January 1st at 00:05 — adds next year to the DB
   */
  @Cron('5 0 1 1 *')
  async handleNewYearCron() {
    const nextYear = new Date().getFullYear() + 1;
    this.logger.log(`[Cron] Ensuring year ${nextYear} exists in DB`);
    await this.ensureYearExists(nextYear);
  }

  async ensureYearExists(year: number): Promise<void> {
    try {
      await this.prisma.vehicleYear.create({
        data: { year, isActive: true },
      });
      this.logger.log(`Year ${year} added to DB`);
    } catch {
      // Already exists
    }
  }

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

    // Ensure next year always exists
    const nextYear = new Date().getFullYear() + 1;
    await this.ensureYearExists(nextYear);

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
