import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTitleDto } from './dto/create-title.dto';
import { UpdateTitleDto } from './dto/update-title.dto';

@Injectable()
export class TitleService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly includeRelations = {
    titleStatus: true,
    brandStatus: true,
    frontImage: true,
    backImage: true,
  };

  /**
   * Get the current (latest) title for a vehicle
   */
  async findByVehicle(vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    const title = await this.prisma.title.findFirst({
      where: { vehicleId },
      include: this.includeRelations,
      orderBy: { createdAt: 'desc' },
    });

    return title;
  }

  /**
   * Create or update the title for a vehicle (upsert)
   * If a title already exists for the vehicle, update it.
   * Otherwise create a new one.
   */
  async upsert(vehicleId: string, dto: CreateTitleDto | UpdateTitleDto) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    // Find existing title for this vehicle
    const existing = await this.prisma.title.findFirst({
      where: { vehicleId },
      orderBy: { createdAt: 'desc' },
    });

    const data: any = {};

    if (dto.titleNumber !== undefined) data.titleNumber = dto.titleNumber;
    if (dto.titleState !== undefined) data.titleState = dto.titleState;
    if (dto.titleStatusId !== undefined) data.titleStatusId = dto.titleStatusId;
    if (dto.brandStatusId !== undefined) data.brandStatusId = dto.brandStatusId;
    if (dto.titleReceivedDate !== undefined) data.titleReceivedDate = dto.titleReceivedDate;
    if (dto.titleIssueDate !== undefined) data.titleIssueDate = dto.titleIssueDate;
    if (dto.titleSentDate !== undefined) data.titleSentDate = dto.titleSentDate;
    if (dto.transferDate !== undefined) data.transferDate = dto.transferDate;
    if (dto.titleAppNumber !== undefined) data.titleAppNumber = dto.titleAppNumber;
    if (dto.frontImageId !== undefined) data.frontImageId = dto.frontImageId || null;
    if (dto.backImageId !== undefined) data.backImageId = dto.backImageId || null;

    if (existing) {
      return this.prisma.title.update({
        where: { id: existing.id },
        data,
        include: this.includeRelations,
      });
    }

    // Create new
    return this.prisma.title.create({
      data: {
        vehicleId,
        titleNumber: dto.titleNumber || undefined,
        titleState: dto.titleState || undefined,
        titleStatusId: dto.titleStatusId || undefined,
        brandStatusId: dto.brandStatusId || undefined,
        titleReceivedDate: dto.titleReceivedDate,
        titleIssueDate: dto.titleIssueDate,
        titleSentDate: dto.titleSentDate,
        transferDate: dto.transferDate,
        titleAppNumber: dto.titleAppNumber,
        frontImageId: dto.frontImageId || undefined,
        backImageId: dto.backImageId || undefined,
      },
      include: this.includeRelations,
    });
  }

  /**
   * Get a title by ID
   */
  async findOne(id: string) {
    const title = await this.prisma.title.findUnique({
      where: { id },
      include: this.includeRelations,
    });

    if (!title) {
      throw new NotFoundException(`Title with ID ${id} not found`);
    }

    return title;
  }

  /**
   * Update a title by ID
   */
  async update(id: string, dto: UpdateTitleDto) {
    const existing = await this.prisma.title.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Title with ID ${id} not found`);
    }

    const data: any = {};

    if (dto.titleNumber !== undefined) data.titleNumber = dto.titleNumber;
    if (dto.titleState !== undefined) data.titleState = dto.titleState;
    if (dto.titleStatusId !== undefined) data.titleStatusId = dto.titleStatusId;
    if (dto.brandStatusId !== undefined) data.brandStatusId = dto.brandStatusId;
    if (dto.titleReceivedDate !== undefined) data.titleReceivedDate = dto.titleReceivedDate;
    if (dto.titleIssueDate !== undefined) data.titleIssueDate = dto.titleIssueDate;
    if (dto.titleSentDate !== undefined) data.titleSentDate = dto.titleSentDate;
    if (dto.transferDate !== undefined) data.transferDate = dto.transferDate;
    if (dto.titleAppNumber !== undefined) data.titleAppNumber = dto.titleAppNumber;
    if (dto.frontImageId !== undefined) data.frontImageId = dto.frontImageId || null;
    if (dto.backImageId !== undefined) data.backImageId = dto.backImageId || null;

    return this.prisma.title.update({
      where: { id },
      data,
      include: this.includeRelations,
    });
  }
}
