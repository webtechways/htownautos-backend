import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkJwtGuard } from '@htownautos/auth';
import { IaaiScraperService } from './iaai-scraper.service';
import { StartIaaiRunDto, UpdateIaaiScraperConfigDto } from './iaai-scraper.dto';

/**
 * Settings → IAAI Scraper control plane. The worker lives in data-sync and
 * reads what these endpoints write (config singleton + runs table).
 */
@ApiTags('IAAI scraper')
@Controller('iaai-scraper')
@UseGuards(ClerkJwtGuard)
@ApiBearerAuth()
export class IaaiScraperController {
  constructor(private readonly service: IaaiScraperService) {}

  @Get('status')
  @ApiOperation({ summary: 'Config, current pass, next scheduled start and counters' })
  status() {
    return this.service.status();
  }

  @Patch('config')
  @ApiOperation({ summary: 'Pause/resume, schedule, pacing and image settings' })
  updateConfig(@Body() dto: UpdateIaaiScraperConfigDto) {
    return this.service.updateConfig(dto);
  }

  @Post('start')
  @ApiOperation({ summary: 'Start a pass now (un-pauses the scraper)' })
  start(@Body() dto: StartIaaiRunDto, @Req() req: any) {
    return this.service.start(dto.maxRunMinutes, req.user?.email ?? req.user?.id ?? null);
  }

  @Post('stop')
  @ApiOperation({ summary: 'Stop the running or queued pass' })
  stop() {
    return this.service.stop();
  }

  @Post('reindex')
  @ApiOperation({ summary: 'Re-index all active IAAI lots into OpenSearch (recreate = delete the index first)' })
  reindex(@Body() body: { recreate?: boolean }) {
    return this.service.reindex(!!body?.recreate);
  }

  @Get('runs')
  @ApiOperation({ summary: 'Pass history, newest first' })
  runs(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.runs(Number(page) || 1, Number(limit) || 20);
  }

  @Get('listings')
  @ApiOperation({ summary: 'Scraped IAAI lots (search by stock, VIN, make/model)' })
  listings(
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('images') images?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listings({ search, active, images, page: Number(page) || 1, limit: Number(limit) || 25 });
  }

  @Post('images/retry-failed')
  @ApiOperation({ summary: 'Send every lot whose photos failed back to the queue' })
  retryImages() {
    return this.service.retryFailedImages();
  }
}
