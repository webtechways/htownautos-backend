import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateVehicleTrimDto } from './dto/create-vehicle-trim.dto';
import { UpdateVehicleTrimDto } from './dto/update-vehicle-trim.dto';
import { QueryVehicleTrimDto } from './dto/query-vehicle-trim.dto';
import { VehicleTrimEntity } from './entities/vehicle-trim.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@Injectable()
export class VehicleTrimService {
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

  async create(createVehicleTrimDto: CreateVehicleTrimDto): Promise<VehicleTrimEntity> {
    const { modelId, name, slug, isActive = true } = createVehicleTrimDto;

    // Verify modelId exists
    const modelExists = await this.prisma.vehicleModel.findUnique({
      where: { id: modelId },
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

    if (!modelExists) {
      throw new NotFoundException(`Vehicle model with ID ${modelId} not found`);
    }

    const finalSlug = slug || this.slugify(name);

    // Check if trim with same slug already exists for this model
    const existingTrim = await this.prisma.vehicleTrim.findUnique({
      where: {
        modelId_slug: {
          modelId,
          slug: finalSlug,
        },
      },
    });

    if (existingTrim) {
      throw new ConflictException(
        `Trim "${name}" already exists for model ${modelExists.name}`,
      );
    }

    const vehicleTrim = await this.prisma.vehicleTrim.create({
      data: {
        modelId,
        name,
        slug: finalSlug,
        isActive,
      },
    });

    return new VehicleTrimEntity(vehicleTrim);
  }

  async findAll(
    query: QueryVehicleTrimDto,
  ): Promise<PaginatedResponseDto<VehicleTrimEntity>> {
    const { page = 1, limit = 10, modelId, makeId, year, isActive } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by isActive
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    // Filter by modelId
    if (modelId !== undefined) {
      const modelExists = await this.prisma.vehicleModel.findUnique({
        where: { id: modelId },
      });

      if (!modelExists) {
        throw new NotFoundException(`Vehicle model with ID ${modelId} not found`);
      }

      where.modelId = modelId;
    }

    // Filter by makeId (through model -> make relationship)
    if (makeId !== undefined) {
      const makeExists = await this.prisma.vehicleMake.findUnique({
        where: { id: makeId },
      });

      if (!makeExists) {
        throw new NotFoundException(`Vehicle make with ID ${makeId} not found`);
      }

      where.model = {
        makeId: makeId,
      };
    }

    // Filter by year (through model -> make -> year relationship)
    if (year !== undefined) {
      const vehicleYear = await this.prisma.vehicleYear.findUnique({
        where: { year },
      });

      if (!vehicleYear) {
        throw new NotFoundException(`Vehicle year ${year} not found`);
      }

      where.model = {
        ...where.model,
        make: {
          yearId: vehicleYear.id,
        },
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.vehicleTrim.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          model: {
            select: {
              name: true,
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
          },
        },
      }),
      this.prisma.vehicleTrim.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item) => new VehicleTrimEntity(item)),
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

  async findOne(id: string): Promise<VehicleTrimEntity> {
    const vehicleTrim = await this.prisma.vehicleTrim.findUnique({
      where: { id },
      include: {
        model: {
          select: {
            name: true,
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
        },
      },
    });

    if (!vehicleTrim) {
      throw new NotFoundException(`Vehicle trim with ID ${id} not found`);
    }

    return new VehicleTrimEntity(vehicleTrim);
  }

  async update(
    id: string,
    updateVehicleTrimDto: UpdateVehicleTrimDto,
  ): Promise<VehicleTrimEntity> {
    // Verify trim exists
    const existingTrim = await this.prisma.vehicleTrim.findUnique({
      where: { id },
    });

    if (!existingTrim) {
      throw new NotFoundException(`Vehicle trim with ID ${id} not found`);
    }

    const { modelId, name, slug, isActive } = updateVehicleTrimDto;

    // If modelId is being changed, verify it exists
    if (modelId && modelId !== existingTrim.modelId) {
      const modelExists = await this.prisma.vehicleModel.findUnique({
        where: { id: modelId },
      });

      if (!modelExists) {
        throw new NotFoundException(`Vehicle model with ID ${modelId} not found`);
      }
    }

    // Generate slug if name is provided but slug is not
    const finalSlug =
      slug || (name ? this.slugify(name) : existingTrim.slug);

    // Check for duplicate slug within the same model
    const targetModelId = modelId || existingTrim.modelId;
    if (finalSlug !== existingTrim.slug || targetModelId !== existingTrim.modelId) {
      const duplicateTrim = await this.prisma.vehicleTrim.findUnique({
        where: {
          modelId_slug: {
            modelId: targetModelId,
            slug: finalSlug,
          },
        },
      });

      if (duplicateTrim && duplicateTrim.id !== id) {
        throw new ConflictException(
          `Trim with slug "${finalSlug}" already exists for this model`,
        );
      }
    }

    const updatedTrim = await this.prisma.vehicleTrim.update({
      where: { id },
      data: {
        ...(modelId && { modelId }),
        ...(name && { name }),
        slug: finalSlug,
        ...(isActive !== undefined && { isActive }),
      },
    });

    return new VehicleTrimEntity(updatedTrim);
  }

  async remove(id: string): Promise<{ message: string }> {
    // Verify trim exists
    const existingTrim = await this.prisma.vehicleTrim.findUnique({
      where: { id },
    });

    if (!existingTrim) {
      throw new NotFoundException(`Vehicle trim with ID ${id} not found`);
    }

    await this.prisma.vehicleTrim.delete({
      where: { id },
    });

    return {
      message: `Vehicle trim with ID ${id} has been successfully deleted`,
    };
  }
}
