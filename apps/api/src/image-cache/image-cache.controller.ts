import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkJwtGuard } from '@htownautos/auth';
import { ImageCacheService } from './image-cache.service';
import { UpdateImageScrapeConfigDto } from './dto/update-image-scrape-config.dto';
import { RetryFailedDto } from './dto/retry-failed.dto';

/**
 * Settings → Image Cache control plane. Global (auction data is shared), staff-only
 * via ClerkJwtGuard. Drives the crawler pause/rate config and exposes the queue,
 * cached lots, failures, and proxy inventory tables.
 */
@ApiTags('Image cache')
@Controller('image-cache')
@UseGuards(ClerkJwtGuard)
@ApiBearerAuth()
export class ImageCacheController {
  constructor(private readonly service: ImageCacheService) {}

  @Get('status')
  @ApiOperation({ summary: 'Live counters, queue depth, ETA and control config' })
  status() {
    return this.service.getStatus();
  }

  @Patch('config')
  @ApiOperation({ summary: 'Pause/resume the crawler and tune rate/retries' })
  updateConfig(@Body() dto: UpdateImageScrapeConfigDto) {
    return this.service.updateConfig(dto);
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Queued/processing jobs (paginated)' })
  jobs(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listJobs({ status, page: Number(page), limit: Number(limit) });
  }

  @Get('failures')
  @ApiOperation({ summary: 'Lots that failed after every retry' })
  failures(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.listFailures({ page: Number(page), limit: Number(limit) });
  }

  @Post('jobs/:lot/retry')
  @ApiOperation({ summary: 'Re-queue a failed lot' })
  retry(@Param('lot') lot: string) {
    return this.service.retryJob(lot);
  }

  @Post('jobs/requeue-retryable')
  @ApiOperation({
    summary: 'Re-queue every failed/skipped lot whose auction has not happened yet',
  })
  requeueRetryable() {
    return this.service.requeueRetryable();
  }

  @Post('jobs/retry')
  @ApiOperation({
    summary: 'Re-queue failed lots: the ones given, or every failed one',
    description: 'Sin `lots` reencola todos los fallidos. Pone attempts a 0.',
  })
  retryMany(@Body() dto: RetryFailedDto) {
    return this.service.retryFailed(dto.lots);
  }

  @Get('cached')
  @ApiOperation({ summary: 'Recently cached lots' })
  cached(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.listCached({ page: Number(page), limit: Number(limit) });
  }

  @Get('proxies')
  @ApiOperation({ summary: 'Proxy inventory incl. retired' })
  proxies() {
    return this.service.listProxies();
  }

  @Post('proxies/resync')
  @ApiOperation({ summary: 'Pull the current Webshare proxy list and refresh inventory' })
  resyncProxies() {
    return this.service.resyncProxies();
  }
}
