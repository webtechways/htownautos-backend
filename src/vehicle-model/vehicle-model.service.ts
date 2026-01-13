import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateVehicleModelDto } from './dto/create-vehicle-model.dto';
import { UpdateVehicleModelDto } from './dto/update-vehicle-model.dto';
import { QueryVehicleModelDto } from './dto/query-vehicle-model.dto';
import { VehicleModelEntity } from './entities/vehicle-model.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@Injectable()
export class VehicleModelService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(text: string): string {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-');
  }

  async create(createVehicleModelDto: CreateVehicleModelDto): Promise<VehicleModelEntity> {
    const { makeId, name, slug, isActive = true } = createVehicleModelDto;

    // Verify makeId exists
    const makeExists = await this.prisma.vehicleMake.findUnique({
      where: { id: makeId },
      include: {
        year: {
          select: {
            year: true,
          },
        },
      },
    });

    if (!makeExists) {
      throw new NotFoundException(`Vehicle make with ID ${makeId} not found`);
    }

    const finalSlug = slug || this.slugify(name);

    // Check if model with same slug already exists for this make
    const existingModel = await this.prisma.vehicleModel.findUnique({
      where: {
        makeId_slug: {
          makeId,
          slug: finalSlug,
        },
      },
    });

    if (existingModel) {
      throw new ConflictException(
        `Model "${name}" already exists for make ${makeExists.name}`,
      );
    }

    const vehicleModel = await this.prisma.vehicleModel.create({
      data: {
        makeId,
        name,
        slug: finalSlug,
        isActive,
      },
    });

    return new VehicleModelEntity(vehicleModel);
  }

  async findAll(
    query: QueryVehicleModelDto,
  ): Promise<PaginatedResponseDto<VehicleModelEntity>> {
    const { page = 1, limit = 10, makeId, year, isActive } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by isActive
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // Filter by makeId
    if (makeId !== undefined) {
      const makeExists = await this.prisma.vehicleMake.findUnique({
        where: { id: makeId },
      });

      if (!makeExists) {
        throw new NotFoundException(`Vehicle make with ID ${makeId} not found`);
      }

      where.makeId = makeId;
    }

    // Filter by year (through make -> year relationship)
    if (year !== undefined) {
      const vehicleYear = await this.prisma.vehicleYear.findUnique({
        where: { year },
      });

      if (!vehicleYear) {
        throw new NotFoundException(`Vehicle year ${year} not found`);
      }

      where.make = {
        yearId: vehicleYear.id,
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.vehicleModel.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          make: {
            select: {
              name: true,
              year: {
                select: {
                  year: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.vehicleModel.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item) => new VehicleModelEntity(item)),
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

  async findOne(id: string): Promise<VehicleModelEntity> {
    const vehicleModel = await this.prisma.vehicleModel.findUnique({
      where: { id },
      include: {
        make: {
          select: {
            name: true,
            year: {
              select: {
                year: true,
              },
            },
          },
        },
      },
    });

    if (!vehicleModel) {
      throw new NotFoundException(`Vehicle model with ID ${id} not found`);
    }

    return new VehicleModelEntity(vehicleModel);
  }

  async update(
    id: string,
    updateVehicleModelDto: UpdateVehicleModelDto,
  ): Promise<VehicleModelEntity> {
    // Verify model exists
    const existingModel = await this.prisma.vehicleModel.findUnique({
      where: { id },
    });

    if (!existingModel) {
      throw new NotFoundException(`Vehicle model with ID ${id} not found`);
    }

    const { makeId, name, slug, isActive } = updateVehicleModelDto;

    // If makeId is being changed, verify it exists
    if (makeId && makeId !== existingModel.makeId) {
      const makeExists = await this.prisma.vehicleMake.findUnique({
        where: { id: makeId },
      });

      if (!makeExists) {
        throw new NotFoundException(`Vehicle make with ID ${makeId} not found`);
      }
    }

    // Generate slug if name is provided but slug is not
    const finalSlug =
      slug || (name ? this.slugify(name) : existingModel.slug);

    // Check for duplicate slug within the same make
    const targetMakeId = makeId || existingModel.makeId;
    if (finalSlug !== existingModel.slug || targetMakeId !== existingModel.makeId) {
      const duplicateModel = await this.prisma.vehicleModel.findUnique({
        where: {
          makeId_slug: {
            makeId: targetMakeId,
            slug: finalSlug,
          },
        },
      });

      if (duplicateModel && duplicateModel.id !== id) {
        throw new ConflictException(
          `Model with slug "${finalSlug}" already exists for this make`,
        );
      }
    }

    const updatedModel = await this.prisma.vehicleModel.update({
      where: { id },
      data: {
        ...(makeId && { makeId }),
        ...(name && { name }),
        slug: finalSlug,
        ...(isActive !== undefined && { isActive }),
      },
    });

    return new VehicleModelEntity(updatedModel);
  }

  async remove(id: string): Promise<{ message: string }> {
    // Verify model exists
    const existingModel = await this.prisma.vehicleModel.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            trims: true,
          },
        },
      },
    });

    if (!existingModel) {
      throw new NotFoundException(`Vehicle model with ID ${id} not found`);
    }

    // Check if model has related trims
    if (existingModel._count.trims > 0) {
      throw new BadRequestException(
        `Cannot delete model with ${existingModel._count.trims} related trims. Set isActive to false instead.`,
      );
    }

    await this.prisma.vehicleModel.delete({
      where: { id },
    });

    return {
      message: `Vehicle model with ID ${id} has been successfully deleted`,
    };
  }
}
