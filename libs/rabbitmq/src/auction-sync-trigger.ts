/**
 * Contract between the api (publisher) and the data-sync worker (consumer)
 * for triggering auction sync jobs over RabbitMQ.
 *
 * The api publishes a message here when a user clicks "Sync now" / "Recreate
 * & import" in the dashboard. data-sync owns the heavy work — the api never
 * blocks an HTTP request on a long-running sync.
 */
export const AUCTION_SYNC_TRIGGER_QUEUE = 'auctions.sync.trigger';

export type AuctionSyncTriggerMessage =
  /** Full Copart pipeline: download CSV → upsert DB → reindex OpenSearch. */
  | { kind: 'copart-import' }
  /** Same as copart-import, but recreate the index first (destructive). */
  | { kind: 'copart-import-recreate' }
  /** Reindex only — pull from PostgreSQL, push to OpenSearch. No CSV. */
  | { kind: 'reindex-copart' }
  /** Reindex every source (currently equivalent to reindex-copart). */
  | { kind: 'reindex-all' }
  /** Volcado de la base a B2, a peticion. El cron diario hace lo mismo. */
  | { kind: 'db-backup' }
  /** Drop and recreate the OpenSearch index, no reimport. */
  | { kind: 'recreate-index' };
