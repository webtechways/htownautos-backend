import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateNoteDto, UpdateNoteDto } from './dto/create-note.dto';
import { QueryNoteDto } from './dto/query-note.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  async create(
    tenantId: string,
    createNoteDto: CreateNoteDto,
    createdById: string,
  ) {
    return this.prisma.note.create({
      data: {
        tenantId,
        content: createNoteDto.content,
        createdById,
        buyerId: createNoteDto.buyerId,
        vehicleId: createNoteDto.vehicleId,
        dealId: createNoteDto.dealId,
      },
      include: {
        createdBy: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async findAll(tenantId: string, query: QueryNoteDto) {
    const { buyerId, vehicleId, dealId, page = 1, limit = 20 } = query;

    const where: Prisma.NoteWhereInput = {
      tenantId,
    };

    if (buyerId) where.buyerId = buyerId;
    if (vehicleId) where.vehicleId = vehicleId;
    if (dealId) where.dealId = dealId;

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.note.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
          },
          buyer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.note.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(tenantId: string, id: string) {
    const note = await this.prisma.note.findFirst({
      where: { id, tenantId },
      include: {
        createdBy: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!note) {
      throw new NotFoundException('Note not found');
    }

    return note;
  }

  async update(tenantId: string, id: string, updateNoteDto: UpdateNoteDto) {
    await this.findOne(tenantId, id);

    return this.prisma.note.update({
      where: { id },
      data: {
        content: updateNoteDto.content,
      },
      include: {
        createdBy: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        },
        buyer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    await this.prisma.note.delete({ where: { id } });

    return { message: 'Note deleted successfully' };
  }

  async findByBuyer(tenantId: string, buyerId: string, query: QueryNoteDto) {
    return this.findAll(tenantId, { ...query, buyerId });
  }
}
