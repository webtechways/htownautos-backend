import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@htownautos/auth';
import { StartPageEventDto } from './dto';
import { PublicStartService } from './public-start.service';

/** Public "link in bio" page (CONTRACT.md §3.9) — no auth, no tenant scope, read by strangers off a shared link. */
@ApiTags('public-start')
@Controller('public/start')
export class PublicStartController {
  constructor(private readonly publicStartService: PublicStartService) {}

  @Get(':slug')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: 'Published start page by slug, enabled blocks only' })
  async getPage(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const page = await this.publicStartService.getBySlug(slug);
    res.setHeader('Cache-Control', 'public, max-age=300');
    return page;
  }

  @Post(':slug/events')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(204)
  @ApiOperation({ summary: 'Record a view/click, daily upsert-increment (not one row per event)' })
  async recordEvent(@Param('slug') slug: string, @Body() dto: StartPageEventDto): Promise<void> {
    await this.publicStartService.recordEvent(slug, dto);
  }
}
