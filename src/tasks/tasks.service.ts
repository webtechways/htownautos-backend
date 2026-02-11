import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateTaskDto, UpdateTaskDto, TaskStatus } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(
    tenantId: string,
    createTaskDto: CreateTaskDto,
    createdById: string,
  ) {
    // Verify assignedTo exists in the tenant
    const assignedTo = await this.prisma.tenantUser.findFirst({
      where: {
        id: createTaskDto.assignedToId,
        tenantId,
        status: 'active',
      },
    });

    if (!assignedTo) {
      throw new NotFoundException('Assigned user not found in this tenant');
    }

    return this.prisma.task.create({
      data: {
        tenantId,
        title: createTaskDto.title,
        description: createTaskDto.description,
        status: createTaskDto.status || TaskStatus.PENDING,
        priority: createTaskDto.priority || 'normal',
        dueDate: createTaskDto.dueDate ? new Date(createTaskDto.dueDate) : null,
        dueTime: createTaskDto.dueTime,
        assignedToId: createTaskDto.assignedToId,
        createdById,
        buyerId: createTaskDto.buyerId,
        vehicleId: createTaskDto.vehicleId,
        dealId: createTaskDto.dealId,
        notes: createTaskDto.notes,
      },
      include: {
        assignedTo: {
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

  async findAll(tenantId: string, query: QueryTaskDto) {
    const {
      status,
      priority,
      assignedToId,
      createdById,
      buyerId,
      vehicleId,
      dealId,
      search,
      page = 1,
      limit = 20,
      sortBy = 'dueDate',
      sortOrder = 'asc',
    } = query;

    const where: Prisma.TaskWhereInput = {
      tenantId,
    };

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignedToId) where.assignedToId = assignedToId;
    if (createdById) where.createdById = createdById;
    if (buyerId) where.buyerId = buyerId;
    if (vehicleId) where.vehicleId = vehicleId;
    if (dealId) where.dealId = dealId;

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    // Handle sorting - null dueDates should come last
    let orderBy: Prisma.TaskOrderByWithRelationInput | Prisma.TaskOrderByWithRelationInput[];

    if (sortBy === 'dueDate') {
      // Sort by dueDate with nulls last
      orderBy = [
        { dueDate: { sort: sortOrder, nulls: 'last' } },
        { createdAt: 'desc' },
      ];
    } else {
      orderBy = { [sortBy]: sortOrder };
    }

    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          assignedTo: {
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
      this.prisma.task.count({ where }),
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
    const task = await this.prisma.task.findFirst({
      where: { id, tenantId },
      include: {
        assignedTo: {
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
            phoneMain: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    return task;
  }

  async update(
    tenantId: string,
    id: string,
    updateTaskDto: UpdateTaskDto,
    requestingTenantUserId: string,
  ) {
    const task = await this.findOne(tenantId, id);

    // If reassigning, verify the new assignee exists
    if (updateTaskDto.assignedToId) {
      const assignedTo = await this.prisma.tenantUser.findFirst({
        where: {
          id: updateTaskDto.assignedToId,
          tenantId,
          status: 'active',
        },
      });

      if (!assignedTo) {
        throw new NotFoundException('Assigned user not found in this tenant');
      }
    }

    const data: Prisma.TaskUpdateInput = {};

    if (updateTaskDto.title !== undefined) data.title = updateTaskDto.title;
    if (updateTaskDto.description !== undefined) data.description = updateTaskDto.description;
    if (updateTaskDto.status !== undefined) {
      data.status = updateTaskDto.status;
      // Set completedAt when marking as completed
      if (updateTaskDto.status === TaskStatus.COMPLETED) {
        data.completedAt = new Date();
      } else if (task.status === 'completed') {
        // Clear completedAt if reopening from completed status
        data.completedAt = null;
      }
    }
    if (updateTaskDto.priority !== undefined) data.priority = updateTaskDto.priority;
    if (updateTaskDto.dueDate !== undefined) {
      data.dueDate = updateTaskDto.dueDate ? new Date(updateTaskDto.dueDate) : null;
    }
    if (updateTaskDto.dueTime !== undefined) data.dueTime = updateTaskDto.dueTime;
    if (updateTaskDto.assignedToId !== undefined) {
      data.assignedTo = { connect: { id: updateTaskDto.assignedToId } };
    }
    if (updateTaskDto.notes !== undefined) data.notes = updateTaskDto.notes;

    return this.prisma.task.update({
      where: { id },
      data,
      include: {
        assignedTo: {
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

    await this.prisma.task.delete({ where: { id } });

    return { message: 'Task deleted successfully' };
  }

  async findByBuyer(tenantId: string, buyerId: string, query: QueryTaskDto) {
    return this.findAll(tenantId, { ...query, buyerId });
  }

  async getMyTasks(tenantId: string, tenantUserId: string, query: QueryTaskDto) {
    return this.findAll(tenantId, { ...query, assignedToId: tenantUserId });
  }
}
