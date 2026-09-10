import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RabbitMQService,
  AUCTION_SYNC_TRIGGER_QUEUE,
  type AuctionSyncTriggerMessage,
} from '@htownautos/rabbitmq';
import { AuctionIndexService, AuctionSyncService } from '@htownautos/opensearch';
import { CopartImportService } from './copart-import.service';
import { DbBackupService } from './db-backup.service';

/**
 * Consumes auction sync trigger messages from the api and dispatches to the
 * heavy services that already live in this worker. Keeps the api process
 * free of long-running DB/OpenSearch work.
 */
@Injectable()
export class SyncTriggerListener implements OnModuleInit {
  private readonly logger = new Logger(SyncTriggerListener.name);

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly importService: CopartImportService,
    private readonly indexService: AuctionIndexService,
    private readonly syncService: AuctionSyncService,
    private readonly backup: DbBackupService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQ.consume(AUCTION_SYNC_TRIGGER_QUEUE, async (raw) => {
      const msg = raw as AuctionSyncTriggerMessage;
      this.logger.log(`[SyncTrigger] received ${msg.kind}`);
      const start = Date.now();
      try {
        await this.handle(msg);
        this.logger.log(
          `[SyncTrigger] done ${msg.kind} in ${Date.now() - start}ms`,
        );
      } catch (err) {
        this.logger.error(
          `[SyncTrigger] failed ${msg.kind}: ${(err as Error).message}`,
          (err as Error).stack,
        );
        throw err;
      }
    });
  }

  private async handle(msg: AuctionSyncTriggerMessage): Promise<void> {
    switch (msg.kind) {
      case 'copart-import':
        await this.importService.runSync();
        return;
      case 'copart-import-recreate':
        await this.indexService.recreateIndex();
        await this.importService.runSync();
        return;
      case 'reindex-copart':
        await this.syncService.syncAllCopart();
        return;
      case 'reindex-all':
        await this.syncService.syncAll();
        return;
      case 'db-backup':
        await this.backup.run();
        return;
      case 'recreate-index':
        await this.indexService.recreateIndex();
        return;
      default: {
        const exhaustive: never = msg;
        this.logger.warn(
          `[SyncTrigger] unknown kind: ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }
}
