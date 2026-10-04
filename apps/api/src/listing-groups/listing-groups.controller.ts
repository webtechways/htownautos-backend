import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ListingGroupsService } from './listing-groups.service';
import { CreateListingGroupDto, UpdateListingGroupDto } from './dto/create-listing-group.dto';
import { AddItemsToGroupDto } from './dto/manage-group-items.dto';
import { CurrentUser, CurrentTenant, ClerkJwtGuard } from '@htownautos/auth';

@ApiTags('Listing Groups')
@Controller('listing-groups')
@UseGuards(ClerkJwtGuard)
export class ListingGroupsController {
  constructor(private readonly service: ListingGroupsService) {}

  @Get()
  @ApiOperation({ summary: 'List all listing groups for the tenant' })
  async findAll(
    @CurrentTenant() tenantId: string,
  ) {
    const data = await this.service.findAll(tenantId);
    return { data };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new listing group' })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: { id: string },
    @Body() dto: CreateListingGroupDto,
  ) {
    return this.service.create(tenantId, user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a listing group' })
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateListingGroupDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a listing group' })
  async remove(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(tenantId, id);
  }

  // NOTE: by-lot must be before :id to avoid route conflict
  @Get('by-lot/:lotNumber')
  @ApiOperation({ summary: 'Get all groups a listing belongs to' })
  async getGroupsForLot(
    @CurrentTenant() tenantId: string,
    @Param('lotNumber') lotNumber: string,
    @Query('auction') auction?: string,
  ) {
    return this.service.getGroupsForLot(tenantId, lotNumber, auction);
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'Get all lot numbers in a group' })
  async getItems(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query('auction') auction?: string,
  ) {
    return this.service.getItems(tenantId, id, auction);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add listings to a group' })
  async addItems(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddItemsToGroupDto,
    @Query('auction') auction?: string,
  ) {
    return this.service.addItems(tenantId, id, dto.lotNumbers, auction);
  }

  @Delete(':id/items/:lotNumber')
  @ApiOperation({ summary: 'Remove a listing from a group' })
  async removeItem(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('lotNumber') lotNumber: string,
    @Query('auction') auction?: string,
  ) {
    return this.service.removeItem(tenantId, id, lotNumber, auction);
  }
}
