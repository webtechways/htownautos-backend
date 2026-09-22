import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { RunpodService } from '@htownautos/common';
import { EmbedJobsController } from './embed-jobs.controller';
import { EmbedPodController } from './embed-pod.controller';
import { OpenSearchLibModule } from '@htownautos/opensearch';
import { EmbedJobsService } from './embed-jobs.service';
import { AuctionIngestGuard } from '../auction-sale-results/auction-ingest.guard';

@Module({
  imports: [OpenSearchLibModule, PrismaModule],
  controllers: [EmbedJobsController, EmbedPodController],
  providers: [EmbedJobsService, RunpodService, AuctionIngestGuard],
  exports: [EmbedJobsService],
})
export class EmbedJobsModule {}
