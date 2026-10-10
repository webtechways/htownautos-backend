import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService, VEHICLE_HISTORY_EXTRACT_QUEUE } from '@htownautos/rabbitmq';
import { PROMPT_VERSION } from '@htownautos/vehicle-history';

/**
 * Catches s3Keys missing an extraction row (never queued, lost message),
 * extracted by an older PROMPT_VERSION, or `failed` with fewer than 3 failed
 * attempt logs (api_error OR invalid_output — both are "the model/call did
 * not produce a usable result", counting only one of them lets the other
 * re-enqueue forever) at the current version. The consumer is the source of
 * truth for "already extracted" — this just finds what it missed.
 */
@Injectable()
export class VehicleHistoryExtractSweeperService {
  private readonly logger = new Logger(VehicleHistoryExtractSweeperService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  @Cron('*/10 * * * *')
  async tick(): Promise<void> {
    if (process.env.VH_EXTRACT_ENABLED === 'false') return;
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
      LEFT JOIN "vehicle_history_extractions" e ON e."s3Key" = s."s3Key"
      WHERE e.id IS NULL
         OR e."promptVersion" < ${PROMPT_VERSION}
         OR (
           e.status = 'failed'
           AND (
             SELECT COUNT(*) FROM "vehicle_history_extraction_logs" l
             WHERE l."s3Key" = s."s3Key" AND l.status IN ('api_error', 'invalid_output') AND l."promptVersion" = ${PROMPT_VERSION}
           ) < 3
           -- 'skipped' (e.g. a PDF under the scraper, which never supports PDFs) is
           -- terminal — unlike api_error/invalid_output, retrying can't help, so it
           -- must not count towards (or be bypassed by) the retry cap above.
           AND NOT EXISTS (
             SELECT 1 FROM "vehicle_history_extraction_logs" l2
             WHERE l2."s3Key" = s."s3Key" AND l2.status = 'skipped' AND l2."promptVersion" = ${PROMPT_VERSION}
           )
         )
      LIMIT 10
    `)) as { s3Key: string }[];
    if (rows.length === 0) return;

    let published = 0;
    for (const row of rows) {
      const ok = await this.rabbitMQ.publish(VEHICLE_HISTORY_EXTRACT_QUEUE, { s3Key: row.s3Key, trigger: 'sweeper' });
      if (ok) published++;
    }
    this.logger.log(`[VhExtractSweep] queued ${published}/${rows.length}`);
  }
}
