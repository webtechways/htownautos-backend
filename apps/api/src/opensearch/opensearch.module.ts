import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@htownautos/prisma';
import { ProxyService, CopartImagesService } from '@htownautos/common';
import { OpenSearchLibModule } from '@htownautos/opensearch';
import { TitleMappingModule } from '../title-mapping/title-mapping.module';
import { AuctionAliasModule } from '../auction-alias/auction-alias.module';
import { PricePredictionModule } from '../price-prediction/price-prediction.module';
import { AuctionSearchService } from './auction-search.service';
import { AuctionSearchController } from './auction-search.controller';
import { AuctionFacetsService } from './auction-facets.service';
import { AuctionFacetsController } from './auction-facets.controller';

/**
 * Heavy CSV import + full reindex used to live here as `CopartImportService`,
 * but they were moved to the `data-sync` worker. The api now only publishes
 * RabbitMQ trigger messages and serves read endpoints.
 */
@Module({
  imports: [
    PricePredictionModule,
    ConfigModule,
    PrismaModule,
    OpenSearchLibModule,
    TitleMappingModule,
    AuctionAliasModule,
  ],
  controllers: [AuctionSearchController, AuctionFacetsController],
  providers: [
    ProxyService,
    CopartImagesService,
    AuctionSearchService,
    AuctionFacetsService,
  ],
  exports: [
    AuctionSearchService,
    AuctionFacetsService,
  ],
})
export class OpenSearchModule {}
