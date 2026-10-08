import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkJwtGuard, CurrentUser } from '@htownautos/auth';
import { IaaiCalendarService } from './iaai-calendar.service';
import { UpdateIaaiCalendarConfigDto } from './dto/update-iaai-calendar-config.dto';
import { SetCalendarStatusDto } from '../auction-calendar/dto/set-calendar-status.dto';

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

  @Patch('status')
  @ApiOperation({ summary: 'Set the status by hand for one or many auctions (auto = clear)' })
  setStatus(@Body() dto: SetCalendarStatusDto, @CurrentUser() user: { email?: string; id?: string } | undefined) {
    return this.service.setStatus(dto.ids, dto.status, user?.email ?? user?.id ?? null);
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update refresh interval, lanes per branch and proxy use' })
  updateConfig(@Body() dto: UpdateIaaiCalendarConfigDto) {
    return this.service.updateConfig(dto);
  }

  /** En segundo plano: el resultado sale en /sync-logs. */
  @Post('refresh')
  @ApiOperation({ summary: 'Start an IAAI calendar sync now (result in /sync-logs)' })
  refresh() {
    this.service.fetchAndStore('manual').catch(() => undefined);
    return { started: true };
  }

  @Get('sync-logs')
  @ApiOperation({ summary: 'Recent IAAI calendar syncs (server or extension) with their result' })
  syncLogs(@Query('limit') limit?: string) {
    return this.service.syncLogs(Number(limit) || 50);
  }
}
