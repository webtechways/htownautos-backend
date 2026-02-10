import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '@prisma/client';

export interface CreateVehiclePartDto {
  partId: string;
  quantity?: number;
  priceAtTime?: number;
  notes?: string;
}

export interface CreatePartAndAssociateDto {
  // Part fields
  name: string;
  partNumber?: string;
  sku?: string;
  description?: string;
  conditionId: string;
  statusId: string;
  categoryId?: string;
  cost?: number;
  price: number;
  quantity: number;
  // Association
  quantityToUse: number;
  notes?: string;
}

@Injectable()
export class VehiclePartsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all parts associated with a vehicle
   */
  async findByVehicle(vehicleId: string, tenantId: string) {
    // Verify vehicle exists and belongs to tenant
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    const vehicleParts = await this.prisma.vehiclePart.findMany({
      where: { vehicleId },
      include: {
        part: {
          include: {
            category: { select: { id: true, slug: true, title: true } },
            condition: { select: { id: true, slug: true, title: true } },
            status: { select: { id: true, slug: true, title: true } },
            mainImage: { select: { id: true, url: true, filename: true } },
          },
        },
      },
      orderBy: { installedAt: 'desc' },
    });

    // Calculate total
    const total = vehicleParts.reduce(
      (sum, vp) => sum + Number(vp.priceAtTime) * vp.quantity,
      0,
    );

    return {
      data: vehicleParts,
      total,
      count: vehicleParts.length,
    };
  }

  /**
   * Associate an existing part from inventory to a vehicle
   * Reduces the part's stock quantity
   */
  async associatePart(
    vehicleId: string,
    dto: CreateVehiclePartDto,
    tenantId: string,
  ) {
    // Verify vehicle exists and belongs to tenant
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    // Verify part exists and belongs to tenant
    const part = await this.prisma.part.findFirst({
      where: {
        id: dto.partId,
        tenantId,
      },
    });

    if (!part) {
      throw new NotFoundException(`Part with ID ${dto.partId} not found`);
    }

    const quantityToUse = dto.quantity || 1;

    // Check if enough stock
    if (part.quantity < quantityToUse) {
      throw new BadRequestException(
        `Not enough stock. Available: ${part.quantity}, Requested: ${quantityToUse}`,
      );
    }

    // Use transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Reduce part stock
      await tx.part.update({
        where: { id: dto.partId },
        data: { quantity: part.quantity - quantityToUse },
      });

      // Create vehicle-part association
      const vehiclePart = await tx.vehiclePart.create({
        data: {
          vehicleId,
          partId: dto.partId,
          quantity: quantityToUse,
          priceAtTime: dto.priceAtTime ?? part.price,
          notes: dto.notes,
        },
        include: {
          part: {
            include: {
              category: { select: { id: true, slug: true, title: true } },
              condition: { select: { id: true, slug: true, title: true } },
              status: { select: { id: true, slug: true, title: true } },
            },
          },
        },
      });

      return vehiclePart;
    });

    return result;
  }

  /**
   * Create a new part in inventory AND associate it to a vehicle
   */
  async createAndAssociate(
    vehicleId: string,
    dto: CreatePartAndAssociateDto,
    tenantId: string,
  ) {
    // Verify vehicle exists and belongs to tenant
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    // Validate condition exists
    const condition = await this.prisma.partCondition.findFirst({
      where: {
        id: dto.conditionId,
        OR: [{ tenantId }, { tenantId: null }],
      },
    });

    if (!condition) {
      throw new NotFoundException(
        `Part condition with ID ${dto.conditionId} not found`,
      );
    }

    // Validate status exists
    const status = await this.prisma.partStatus.findFirst({
      where: {
        id: dto.statusId,
        OR: [{ tenantId }, { tenantId: null }],
      },
    });

    if (!status) {
      throw new NotFoundException(
        `Part status with ID ${dto.statusId} not found`,
      );
    }

    const quantityToUse = dto.quantityToUse || 1;
    const totalQuantity = dto.quantity || quantityToUse;

    if (quantityToUse > totalQuantity) {
      throw new BadRequestException(
        `Cannot use more than the total quantity. Total: ${totalQuantity}, To use: ${quantityToUse}`,
      );
    }

    // Use transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the part with remaining quantity
      const part = await tx.part.create({
        data: {
          tenantId,
          name: dto.name,
          partNumber: dto.partNumber,
          sku: dto.sku,
          description: dto.description,
          conditionId: dto.conditionId,
          statusId: dto.statusId,
          categoryId: dto.categoryId,
          cost: dto.cost,
          price: dto.price,
          quantity: totalQuantity - quantityToUse, // Remaining after association
        },
      });

      // Create vehicle-part association
      const vehiclePart = await tx.vehiclePart.create({
        data: {
          vehicleId,
          partId: part.id,
          quantity: quantityToUse,
          priceAtTime: dto.price,
          notes: dto.notes,
        },
        include: {
          part: {
            include: {
              category: { select: { id: true, slug: true, title: true } },
              condition: { select: { id: true, slug: true, title: true } },
              status: { select: { id: true, slug: true, title: true } },
            },
          },
        },
      });

      return vehiclePart;
    });

    return result;
  }

  /**
   * Remove a part association from a vehicle
   * Optionally restore the stock
   */
  async removeAssociation(
    vehicleId: string,
    vehiclePartId: string,
    tenantId: string,
    restoreStock = false,
  ) {
    // Verify vehicle exists and belongs to tenant
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenantId },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    // Find the association
    const vehiclePart = await this.prisma.vehiclePart.findFirst({
      where: { id: vehiclePartId, vehicleId },
      include: { part: true },
    });

    if (!vehiclePart) {
      throw new NotFoundException(
        `Vehicle part association with ID ${vehiclePartId} not found`,
      );
    }

    // Use transaction
    await this.prisma.$transaction(async (tx) => {
      // Optionally restore stock
      if (restoreStock) {
        await tx.part.update({
          where: { id: vehiclePart.partId },
          data: {
            quantity: vehiclePart.part.quantity + vehiclePart.quantity,
          },
        });
      }

      // Delete association
      await tx.vehiclePart.delete({
        where: { id: vehiclePartId },
      });
    });

    return {
      message: `Part association removed${restoreStock ? ' and stock restored' : ''}`,
    };
  }

  /**
   * Get available parts from inventory for association
   */
  async getAvailableParts(tenantId: string, search?: string) {
    const where: Prisma.PartWhereInput = {
      tenantId,
      quantity: { gt: 0 }, // Only parts with stock
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { partNumber: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
      ];
    }

    const parts = await this.prisma.part.findMany({
      where,
      include: {
        category: { select: { id: true, slug: true, title: true } },
        condition: { select: { id: true, slug: true, title: true } },
        status: { select: { id: true, slug: true, title: true } },
        mainImage: { select: { id: true, url: true, filename: true } },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });

    return parts;
  }
}
