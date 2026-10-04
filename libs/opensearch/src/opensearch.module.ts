import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { OpenSearchService } from './opensearch.service';
import { AuctionIndexService } from './auction-index.service';
import { AuctionSyncService } from './auction-sync.service';
import { IaaiIndexService } from './iaai-index.service';

@Module({
  imports: [PrismaModule],
  providers: [
    OpenSearchService,
    AuctionIndexService,
    AuctionSyncService,
    IaaiIndexService,
  ],
  exports: [
    OpenSearchService,
    AuctionIndexService,
    AuctionSyncService,
    IaaiIndexService,
  ],
})
export class OpenSearchLibModule {}
