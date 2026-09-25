import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService, CLERK_EVENTS_QUEUE } from '@htownautos/rabbitmq';
import { MAX_CLERK_EVENT_ATTEMPTS } from './clerk-events.consumer';

/** Un evento sin procesar mas viejo que esto se asume perdido (mensaje caido de RabbitMQ). */
const PENDING_STALE_MIN = 2;

/**
 * Sweep para `clerk_webhook_events` (CLERK-SYNC-DESIGN.md, paquete B3).
 * Reintenta filas con `processedAt IS NULL` — mensaje perdido, o falla
 * transitoria del consumer — con backoff exponencial (2^attempts min, tope
 * 240min), hasta MAX_CLERK_EVENT_ATTEMPTS. Pasado eso, el evento queda
 * "envenenado": ya no se reintenta solo, pero sigue en la tabla (con su
 * `error`) para revision manual — nunca se marca `processedAt` sin haberse
 * aplicado de verdad.
 */
@Injectable()
export class ClerkEventsSweepService {
  private readonly logger = new Logger(ClerkEventsSweepService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (process.env.CLERK_SYNC_ENABLED !== 'true') return;
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
    const staleCutoff = new Date(Date.now() - PENDING_STALE_MIN * 60 * 1000);

    const candidates = await this.prisma.clerkWebhookEvent.findMany({
      where: { processedAt: null, attempts: { lt: MAX_CLERK_EVENT_ATTEMPTS }, createdAt: { lt: staleCutoff } },
      select: { id: true, attempts: true, createdAt: true },
    });

    const due = candidates.filter((e) => {
      if (e.attempts === 0) return true; // never tried yet — the staleness cutoff already gates this
      const backoffMin = Math.min(2 ** e.attempts, 240);
      const dueAt = new Date(e.createdAt.getTime() + backoffMin * 60 * 1000);
      return dueAt <= new Date();
    });
    if (due.length === 0) return;

    let published = 0;
    for (const e of due) {
      const ok = await this.rabbitMQ.publish(CLERK_EVENTS_QUEUE, { eventId: e.id });
      if (ok) published++;
    }

    this.logger.log(`clerk events sweep: ${due.length} due — ${published}/${due.length} republished`);
  }
}
