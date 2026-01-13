import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateExtraExpenseDto } from './dto/create-extra-expense.dto';
import { UpdateExtraExpenseDto } from './dto/update-extra-expense.dto';
import { QueryExtraExpenseDto } from './dto/query-extra-expense.dto';
import { ExtraExpenseEntity } from './entities/extra-expense.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ExtraExpenseService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createExtraExpenseDto: CreateExtraExpenseDto,
  ): Promise<ExtraExpenseEntity> {
    const { vehicleId, description, price, receiptId } =
      createExtraExpenseDto;

    // Verify vehicleId exists
    const vehicleExists = await this.prisma.getModel('vehicle').findUnique({
      where: { id: vehicleId },
    });

    if (!vehicleExists) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    // Verify receiptId exists if provided
    if (receiptId) {
      const receiptExists = await this.prisma.getModel('media').findUnique({
        where: { id: receiptId },
      });

      if (!receiptExists) {
        throw new NotFoundException(`Receipt with ID ${receiptId} not found`);
      }
    }

    const extraExpense = await this.prisma.getModel('extraExpense').create({
      data: {
        vehicleId,
        description,
        price: new Prisma.Decimal(price),
        ...(receiptId && { receiptId }),
      },
    });

    return new ExtraExpenseEntity(extraExpense);
  }

  async findAll(
    query: QueryExtraExpenseDto,
  ): Promise<PaginatedResponseDto<ExtraExpenseEntity>> {
    const { page = 1, limit = 10, vehicleId } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    // Filter by vehicleId
    if (vehicleId !== undefined) {
      const vehicleExists = await this.prisma.getModel('vehicle').findUnique({
        where: { id: vehicleId },
      });

      if (!vehicleExists) {
        throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
      }

      where.vehicleId = vehicleId;
    }

    const [data, total] = await Promise.all([
      this.prisma.getModel('extraExpense').findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vehicle: {
            select: {
              vin: true,
              year: true,
              make: true,
              model: true,
            },
          },
        },
      }),
      this.prisma.getModel('extraExpense').count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item: any) => new ExtraExpenseEntity(item)),
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

  async findOne(id: string): Promise<ExtraExpenseEntity> {
    const extraExpense = await this.prisma.getModel('extraExpense').findUnique({
      where: { id },
      include: {
        vehicle: {
          select: {
            vin: true,
            year: true,
            make: true,
            model: true,
          },
        },
        receipt: true,
      },
    });

    if (!extraExpense) {
      throw new NotFoundException(`Extra expense with ID ${id} not found`);
    }

    return new ExtraExpenseEntity(extraExpense);
  }

  async update(
    id: string,
    updateExtraExpenseDto: UpdateExtraExpenseDto,
  ): Promise<ExtraExpenseEntity> {
    // Verify expense exists
    const existingExpense = await this.prisma.getModel('extraExpense').findUnique({
      where: { id },
    });

    if (!existingExpense) {
      throw new NotFoundException(`Extra expense with ID ${id} not found`);
    }

    const { vehicleId, description, price, receiptId } =
      updateExtraExpenseDto;

    // If vehicleId is being changed, verify it exists
    if (vehicleId && vehicleId !== existingExpense.vehicleId) {
      const vehicleExists = await this.prisma.getModel('vehicle').findUnique({
        where: { id: vehicleId },
      });

      if (!vehicleExists) {
        throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
      }
    }

    // If receiptId is being changed, verify it exists
    if (receiptId && receiptId !== existingExpense.receiptId) {
      const receiptExists = await this.prisma.getModel('media').findUnique({
        where: { id: receiptId },
      });

      if (!receiptExists) {
        throw new NotFoundException(`Receipt with ID ${receiptId} not found`);
      }
    }

    const updated = await this.prisma.getModel('extraExpense').update({
      where: { id },
      data: {
        ...(vehicleId && { vehicleId }),
        ...(description && { description }),
        ...(price !== undefined && { price: new Prisma.Decimal(price) }),
        ...(receiptId !== undefined && { receiptId }),
      },
    });

    return new ExtraExpenseEntity(updated);
  }

  async remove(id: string): Promise<{ message: string }> {
    // Verify expense exists
    const existingExpense = await this.prisma.getModel('extraExpense').findUnique({
      where: { id },
    });

    if (!existingExpense) {
      throw new NotFoundException(`Extra expense with ID ${id} not found`);
    }

    await this.prisma.getModel('extraExpense').delete({
      where: { id },
    });

    return {
      message: `Extra expense with ID ${id} has been successfully deleted`,
    };
  }

  async getVehicleTotal(vehicleId: string): Promise<{ total: number }> {
    // Verify vehicle exists
    const vehicleExists = await this.prisma.getModel('vehicle').findUnique({
      where: { id: vehicleId },
    });

    if (!vehicleExists) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    const expenses = await this.prisma.getModel('extraExpense').findMany({
      where: { vehicleId },
      select: { price: true },
    });

    const total = expenses.reduce(
      (sum: number, expense: any) => sum + Number(expense.price),
      0,
    );

    return { total };
  }
}
