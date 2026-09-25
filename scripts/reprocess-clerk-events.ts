/**
 * Re-publish stuck `clerk_webhook_events` rows to the `identity.clerk.events`
 * queue — for events that were inserted by the webhook controller (svix
 * verified) but never got picked up/finished by `ClerkEventsConsumer`
 * (data-sync was down, a deploy raced the consumer, etc).
 *
 * `processEvent` in the consumer always re-reads the row fresh and no-ops if
 * `processedAt` is already set, so re-publishing is safe even for an event
 * that actually did finish — this script exists for the case where it
 * didn't. Only targets `processedAt IS NULL AND attempts < 8` — past that
 * the consumer's own sweep already treats it as a poison event, and forcing
 * a 9th attempt would just burn another Clerk error without a fix.
 *
 * Usage:
 *   npx ts-node scripts/reprocess-clerk-events.ts --dry-run   # default, report only
 *   npx ts-node scripts/reprocess-clerk-events.ts --apply     # re-publishes to identity.clerk.events
 *
 * Per house rules, this script is written but NOT run by the backend agent —
 * CI/CD runs it against production with the user's approval.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { RabbitMQService, CLERK_EVENTS_QUEUE } from '@htownautos/rabbitmq';

const APPLY = process.argv.includes('--apply');

/** Mirrors MAX_CLERK_EVENT_ATTEMPTS in apps/data-sync/src/identity/clerk-events.consumer.ts. */
const MAX_ATTEMPTS = 8;

async function main() {
  console.log(`Clerk webhook event reprocess — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const rabbitMQ = new RabbitMQService();
  if (APPLY) await rabbitMQ.onModuleInit();

  try {
    const stuck = await prisma.clerkWebhookEvent.findMany({
      where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS } },
      select: { id: true, type: true, attempts: true, error: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`Found ${stuck.length} unprocessed event(s) with attempts < ${MAX_ATTEMPTS}:\n`);
    for (const ev of stuck) {
      console.log(
        `  ${ev.id} (${ev.type}) attempts=${ev.attempts} createdAt=${ev.createdAt.toISOString()}${ev.error ? ` lastError=${ev.error}` : ''}`,
      );
    }

    if (APPLY) {
      for (const ev of stuck) {
        await rabbitMQ.publish(CLERK_EVENTS_QUEUE, { eventId: ev.id });
      }
      console.log(`\nRe-published ${stuck.length} event(s) to ${CLERK_EVENTS_QUEUE}.`);
    } else {
      console.log(`\nDry-run — nothing published. Re-run with --apply to publish.`);
    }
  } finally {
    if (APPLY) await rabbitMQ.onModuleDestroy();
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
