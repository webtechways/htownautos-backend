import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkJwtGuard } from '@htownautos/auth';
import { IaaiCalendarService } from './iaai-calendar.service';
import { UpdateIaaiCalendarConfigDto } from './dto/update-iaai-calendar-config.dto';

@ApiTags('IAAI calendar')
@Controller('iaai-calendar')
@UseGuards(ClerkJwtGuard)
@ApiBearerAuth()
export class IaaiCalendarController {
  constructor(private readonly service: IaaiCalendarService) {}

  @Get('status')
  @ApiOperation({ summary: 'Scraper config, last run and counts' })
  status() {
    return this.service.status();
  }

  @Get()
  @ApiOperation({ summary: 'IAAI auctions (when=live|upcoming|today|past|all, q, page, pageSize)' })
  list(
    @Query('when') when?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.list({ when, q, page: Number(page) || 1, pageSize: Number(pageSize) || 50 });
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update refresh interval, lanes per branch and proxy use' })
  updateConfig(@Body() dto: UpdateIaaiCalendarConfigDto) {
    return this.service.updateConfig(dto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Fetch iaai.com/branchlocations now' })
  refresh() {
    return this.service.fetchAndStore();
  }
}
