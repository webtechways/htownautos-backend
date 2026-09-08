import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkJwtGuard } from '@htownautos/auth';
import { AuctionFramesService } from './auction-frames.service';

/** Auction Data → Live Feed: qué está llegando y en qué estado está la cola. */
@ApiTags('Auction Sale Results')
@Controller('auction-frames')
@UseGuards(ClerkJwtGuard)
@ApiBearerAuth()
export class AuctionFramesController {
  constructor(private readonly frames: AuctionFramesService) {}

  @Get('status')
  @ApiOperation({ summary: 'Live counters + the last frames that arrived' })
  status() {
    return this.frames.status();
  }

  @Post('requeue')
  @ApiOperation({
    summary: 'Re-queue frames stuck in pending, or every failed one',
    description:
      'Lo que hace util guardar el frame crudo: cuando se arregla el parser se ' +
      'relanza sobre lo ya recibido, sin haber perdido nada.',
  })
  requeue(@Query('status') status?: string, @Query('olderThanMinutes') mins?: string) {
    const s = status === 'failed' ? 'failed' : 'pending';
    return this.frames.requeue(s, Number(mins) || 0);
  }
}
