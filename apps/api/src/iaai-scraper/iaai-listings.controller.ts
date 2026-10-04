import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkJwtGuard } from '@htownautos/auth';
import { SearchAuctionsDto } from '../opensearch/dto/search-auctions.dto';
import { IaaiListingsService } from './iaai-listings.service';

/** Same contract as /auctions/search, /auctions/filters and the gallery route, for IAAI lots. */
@ApiTags('IAAI listings')
@Controller('iaai-listings')
@UseGuards(ClerkJwtGuard)
@ApiBearerAuth()
export class IaaiListingsController {
  constructor(private readonly service: IaaiListingsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search scraped IAAI lots (same parameters and shape as /auctions/search)' })
  search(@Query() q: SearchAuctionsDto) {
    return this.service.search(q);
  }

  @Get('filters')
  @ApiOperation({ summary: 'Facets with counts, cascading by make/model' })
  filters(@Query() q: SearchAuctionsDto) {
    return this.service.filters(q);
  }

  @Get('get-gallery/:stock')
  @ApiOperation({ summary: 'Photos of an IAAI lot (our copies once cached, IAAI URLs until then)' })
  gallery(@Param('stock') stock: string) {
    return this.service.gallery(stock);
  }

  @Get(':stock')
  @ApiOperation({ summary: 'One IAAI lot in the auction listing shape' })
  one(@Param('stock') stock: string) {
    return this.service.getOne(stock);
  }
}
