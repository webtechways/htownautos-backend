import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateVehicleMakeDto } from './dto/create-vehicle-make.dto';
import { UpdateVehicleMakeDto } from './dto/update-vehicle-make.dto';
import { QueryVehicleMakeDto } from './dto/query-vehicle-make.dto';
import { VehicleMakeEntity } from './entities/vehicle-make.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@Injectable()
export class VehicleMakeService {
  constructor(private readonly prisma: PrismaService) { }

  private slugify(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  }

  async create(createVehicleMakeDto: CreateVehicleMakeDto): Promise<VehicleMakeEntity> {
    const { yearId, name, slug, isActive = true } = createVehicleMakeDto;

    // Verify yearId exists
    const yearExists = await this.prisma.vehicleYear.findUnique({
      where: { id: yearId },
    });

    if (!yearExists) {
      throw new NotFoundException(`Vehicle year with ID ${yearId} not found`);
    }

    const finalSlug = slug || this.slugify(name);

    // Check if make with same slug already exists for this year
    const existingMake = await this.prisma.vehicleMake.findUnique({
      where: {
        yearId_slug: {
          yearId,
          slug: finalSlug,
        },
      },
    });

    if (existingMake) {
      throw new ConflictException(
        `Make "${name}" already exists for year ${yearExists.year}`,
      );
    }

    const vehicleMake = await this.prisma.vehicleMake.create({
      data: {
        yearId,
        name,
        slug: finalSlug,
        isActive,
      },
    });

    return new VehicleMakeEntity(vehicleMake);
  }

  async findAll(
    query: QueryVehicleMakeDto,
  ): Promise<PaginatedResponseDto<VehicleMakeEntity>> {
    const { page = 1, limit = 10, year, isActive } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by isActive
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // Filter by year
    if (year !== undefined) {
      const vehicleYear = await this.prisma.vehicleYear.findUnique({
        where: { year },
      });

      if (!vehicleYear) {
        throw new NotFoundException(`Vehicle year ${year} not found`);
      }

      where.yearId = vehicleYear.id;
    }

    const [data, total] = await Promise.all([
      this.prisma.vehicleMake.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          year: {
            select: {
              year: true,
            },
          },
        },
      }),
      this.prisma.vehicleMake.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item) => new VehicleMakeEntity(item)),
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

  async findOne(id: string): Promise<VehicleMakeEntity> {
    const vehicleMake = await this.prisma.vehicleMake.findUnique({
      where: { id },
      include: {
        year: {
          select: {
            year: true,
          },
        },
      },
    });

    if (!vehicleMake) {
      throw new NotFoundException(`Vehicle make with ID ${id} not found`);
    }

    return new VehicleMakeEntity(vehicleMake);
  }

  async update(
    id: string,
    updateVehicleMakeDto: UpdateVehicleMakeDto,
  ): Promise<VehicleMakeEntity> {
    // Verify make exists
    const existingMake = await this.prisma.vehicleMake.findUnique({
      where: { id },
    });

    if (!existingMake) {
      throw new NotFoundException(`Vehicle make with ID ${id} not found`);
    }

    const { yearId, name, slug, isActive } = updateVehicleMakeDto;

    // If yearId is being changed, verify it exists
    if (yearId && yearId !== existingMake.yearId) {
      const yearExists = await this.prisma.vehicleYear.findUnique({
        where: { id: yearId },
      });

      if (!yearExists) {
        throw new NotFoundException(`Vehicle year with ID ${yearId} not found`);
      }
    }

    // Generate slug if name is provided but slug is not
    const finalSlug =
      slug || (name ? this.slugify(name) : existingMake.slug);

    // Check for duplicate slug within the same year
    const targetYearId = yearId || existingMake.yearId;
    if (finalSlug !== existingMake.slug || targetYearId !== existingMake.yearId) {
      const duplicateMake = await this.prisma.vehicleMake.findUnique({
        where: {
          yearId_slug: {
            yearId: targetYearId,
            slug: finalSlug,
          },
        },
      });

      if (duplicateMake && duplicateMake.id !== id) {
        throw new ConflictException(
          `Make with slug "${finalSlug}" already exists for this year`,
        );
      }
    }

    const updatedMake = await this.prisma.vehicleMake.update({
      where: { id },
      data: {
        ...(yearId && { yearId }),
        ...(name && { name }),
        slug: finalSlug,
        ...(isActive !== undefined && { isActive }),
      },
    });

    return new VehicleMakeEntity(updatedMake);
  }

  async remove(id: string): Promise<{ message: string }> {
    // Verify make exists
    const existingMake = await this.prisma.vehicleMake.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            models: true,
          },
        },
      },
    });

    if (!existingMake) {
      throw new NotFoundException(`Vehicle make with ID ${id} not found`);
    }

    // Check if make has related models
    if (existingMake._count.models > 0) {
      throw new BadRequestException(
        `Cannot delete make with ${existingMake._count.models} related models. Set isActive to false instead.`,
      );
    }

    await this.prisma.vehicleMake.delete({
      where: { id },
    });

    return {
      message: `Vehicle make with ID ${id} has been successfully deleted`,
    };
  }
}
