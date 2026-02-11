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
import { NotesService } from './notes.service';
import { CreateNoteDto, UpdateNoteDto } from './dto/create-note.dto';
import { QueryNoteDto } from './dto/query-note.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser } from '../auth/guards/cognito-jwt.guard';

@ApiTags('Notes')
@ApiBearerAuth()
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  private getTenantUserId(user: AuthenticatedUser, tenantId: string): string {
    const tenantUser = user.tenants?.find(
      (t) => t.tenantId === tenantId || t.tenant?.id === tenantId,
    );
    if (!tenantUser) {
      throw new BadRequestException('User is not a member of this tenant');
    }
    return tenantUser.id;
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new note',
    description: 'Creates a rich text note associated with an entity',
  })
  @ApiResponse({ status: 201, description: 'Note created successfully' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() createNoteDto: CreateNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.notesService.create(tenantId, createNoteDto, tenantUserId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all notes',
    description: 'Retrieves all notes for the current tenant with optional filters',
  })
  @ApiResponse({ status: 200, description: 'List of notes' })
  findAll(@CurrentTenant() tenantId: string, @Query() query: QueryNoteDto) {
    return this.notesService.findAll(tenantId, query);
  }

  @Get('by-buyer/:buyerId')
  @ApiOperation({
    summary: 'Get notes by buyer',
    description: 'Retrieves all notes related to a specific buyer/customer',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'List of notes for the buyer' })
  findByBuyer(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: QueryNoteDto,
  ) {
    return this.notesService.findByBuyer(tenantId, buyerId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get note by ID',
    description: 'Retrieves a single note by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Note UUID' })
  @ApiResponse({ status: 200, description: 'Note found' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notesService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update note',
    description: 'Updates a note by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Note UUID' })
  @ApiResponse({ status: 200, description: 'Note updated successfully' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateNoteDto: UpdateNoteDto,
  ) {
    return this.notesService.update(tenantId, id, updateNoteDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete note',
    description: 'Permanently deletes a note',
  })
  @ApiParam({ name: 'id', description: 'Note UUID' })
  @ApiResponse({ status: 200, description: 'Note deleted successfully' })
  @ApiResponse({ status: 404, description: 'Note not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notesService.remove(tenantId, id);
  }
}
