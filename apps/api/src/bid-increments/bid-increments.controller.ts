import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_ROLES, ClerkJwtGuard, CurrentUser, RequireRoles, RolesGuard } from '@htownautos/auth';
import { BidIncrementsService } from './bid-increments.service';
import { SaveBidIncrementsDto } from './dto/save-bid-increments.dto';

/**
 * Jumping Table: el salto de cada puja en sala segun el precio. Con ella y el
 * numero de pujas se reconstruye el precio final de un lote sin conocer los
 * importes. Se edita en Ajustes → Jumping Table Copart.
 */
@ApiTags('Auction bid increments')
@Controller('auctions/bid-increments')
@UseGuards(ClerkJwtGuard)
@ApiBearerAuth()
export class BidIncrementsController {
  constructor(private readonly service: BidIncrementsService) {}

  @Get()
  @ApiOperation({ summary: 'Jumping Table of an auction (defaults to copart)' })
  get(@Query('auction') auction?: string) {
    return this.service.get(auction || 'copart');
  }

  @Put(':auction')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({ summary: 'Replace the whole Jumping Table of an auction (admin)' })
  save(
    @Param('auction') auction: string,
    @Body() dto: SaveBidIncrementsDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.save(auction, dto.rows, userId ?? null);
  }
}
