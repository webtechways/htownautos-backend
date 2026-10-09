import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService, VEHICLE_HISTORY_PARSE_QUEUE } from '@htownautos/rabbitmq';
import { PARSER_VERSION } from '@htownautos/vehicle-history';

/**
 * Catches s3Keys missing a `vehicle_history_parsed` row (never queued, lost
 * message) or parsed by an older `PARSER_VERSION`. The consumer is the
 * source of truth for "already parsed" — this just finds what it missed.
 */
@Injectable()
export class VehicleHistoryParseSweeperService {
  private readonly logger = new Logger(VehicleHistoryParseSweeperService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  @Cron('*/10 * * * *')
  async tick(): Promise<void> {
    if (process.env.VH_PARSE_ENABLED === 'false') return;
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(`sweep failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async sweep(): Promise<void> {
    const rows = (await this.prisma.$queryRaw(Prisma.sql`
      SELECT s."s3Key" FROM (
        SELECT "s3Key" FROM "carfax_reports"
        UNION
        SELECT "s3Key" FROM "vehicle_history_reports"
      ) s
      LEFT JOIN "vehicle_history_parsed" p ON p."s3Key" = s."s3Key"
      WHERE p.id IS NULL OR p."parserVersion" < ${PARSER_VERSION}
      LIMIT 20
    `)) as { s3Key: string }[];
    if (rows.length === 0) return;

    let published = 0;
    for (const row of rows) {
      const ok = await this.rabbitMQ.publish(VEHICLE_HISTORY_PARSE_QUEUE, { s3Key: row.s3Key });
      if (ok) published++;
    }
    this.logger.log(`[VhParseSweep] queued ${published}/${rows.length}`);
  }
}
