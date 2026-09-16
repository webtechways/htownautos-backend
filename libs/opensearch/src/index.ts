export { OpenSearchLibModule } from './opensearch.module';
export { OpenSearchService } from './opensearch.service';
export { AuctionIndexService, AUCTION_INDEX_NAME } from './auction-index.service';
export { AuctionSyncService, parseListingImages } from './auction-sync.service';
export type {
  UnifiedAuction,
  UnifiedAuctionDocument,
  AuctionSource,
  AuctionAggregations,
  AuctionSearchResult,
} from './dto/unified-auction.interface';
