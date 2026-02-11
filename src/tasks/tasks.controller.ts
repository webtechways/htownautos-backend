import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/create-task.dto';
import { QueryTaskDto } from './dto/query-task.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser } from '../auth/guards/cognito-jwt.guard';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  private getTenantUserId(user: AuthenticatedUser, tenantId: string): string {
    const tenantUser = user.tenants?.find(t => t.tenantId === tenantId || t.tenant?.id === tenantId);
    if (!tenantUser) {
      throw new BadRequestException('User is not a member of this tenant');
    }
    return tenantUser.id;
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new task',
    description: 'Creates a task and assigns it to a user in the tenant',
  })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 404, description: 'Assigned user not found' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() createTaskDto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.tasksService.create(tenantId, createTaskDto, tenantUserId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all tasks',
    description: 'Retrieves all tasks for the current tenant with optional filters',
  })
  @ApiResponse({ status: 200, description: 'List of tasks' })
  findAll(@CurrentTenant() tenantId: string, @Query() query: QueryTaskDto) {
    return this.tasksService.findAll(tenantId, query);
  }

  @Get('my-tasks')
  @ApiOperation({
    summary: 'Get my tasks',
    description: 'Retrieves tasks assigned to the current user',
  })
  @ApiResponse({ status: 200, description: 'List of tasks assigned to current user' })
  getMyTasks(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryTaskDto,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.tasksService.getMyTasks(tenantId, tenantUserId, query);
  }

  @Get('by-buyer/:buyerId')
  @ApiOperation({
    summary: 'Get tasks by buyer',
    description: 'Retrieves all tasks related to a specific buyer/customer',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'List of tasks for the buyer' })
  findByBuyer(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: QueryTaskDto,
  ) {
    return this.tasksService.findByBuyer(tenantId, buyerId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get task by ID',
    description: 'Retrieves a single task by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task found' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update task',
    description: 'Updates a task by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task updated successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTaskDto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.tasksService.update(tenantId, id, updateTaskDto, tenantUserId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete task',
    description: 'Permanently deletes a task',
  })
  @ApiParam({ name: 'id', description: 'Task UUID' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.remove(tenantId, id);
  }
}
