/**
 * One-off backfill: mirrors every existing `SmsMessage` row into the unified
 * inbox (`InboxConversation`/`InboxMessage`) — for tenants that used SMS
 * before the Social Suite's inbox existed. Idempotent: skips any
 * `SmsMessage` that already has a linked `InboxMessage` (unique on
 * `smsMessageId`), safe to re-run.
 *
 * Does NOT send notifications or realtime events (this is historical data,
 * not something that just happened) and does NOT try to reconstruct
 * per-message unread state — it sets each conversation's final
 * `unreadCount` once, from `SmsMessage.isRead = false` inbound rows, instead
 * of incrementing it once per historical inbound message (which would leave
 * a huge stale unread count that nobody can act on).
 *
 * Usage:
 *   npx ts-node scripts/backfill-sms-inbox.ts --dry-run   # report only, no writes
 *   npx ts-node scripts/backfill-sms-inbox.ts             # apply
 *
 * Per house rules, this script is written but NOT run by the backend agent —
 * CI/CD runs it against production with the user's approval.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { normalizePhoneNumber } from '@htownautos/common';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 500;
const PREVIEW_MAX_CHARS = 140;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

interface ConversationKey {
  tenantId: string;
  channel: string;
  senderKey: string;
  contactExternalId: string;
}

function keyFor(k: ConversationKey): string {
  return `${k.tenantId}::${k.channel}::${k.senderKey}::${k.contactExternalId}`;
}

async function main() {
  console.log(`backfill-sms-inbox: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLYING'}`);

  const phoneNumbers = await prisma.twilioPhoneNumber.findMany({ select: { id: true, tenantId: true, phoneNumber: true } });
  const phoneByTenantAndNumber = new Map(phoneNumbers.map((p) => [`${p.tenantId}::${p.phoneNumber}`, p.id]));

  let cursor: string | undefined;
  let processed = 0;
  let created = 0;
  let skippedExisting = 0;
  let skippedNoPhone = 0;
  const touchedConversations = new Set<string>();

  for (;;) {
    const rows = await prisma.smsMessage.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { createdAt: 'asc' },
      include: { inboxMessage: { select: { id: true } } },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const sms of rows) {
      processed++;
      if (sms.inboxMessage) {
        skippedExisting++;
        continue;
      }

      const isOutbound = sms.direction === 'outbound';
      const ourNumber = isOutbound ? sms.fromNumber : sms.toNumber;
      const theirNumberRaw = isOutbound ? sms.toNumber : sms.fromNumber;
      const theirNumber = normalizePhoneNumber(theirNumberRaw) || theirNumberRaw;

      const senderKey = phoneByTenantAndNumber.get(`${sms.tenantId}::${ourNumber}`);
      if (!senderKey) {
        skippedNoPhone++;
        continue;
      }

      const convoKey: ConversationKey = { tenantId: sms.tenantId, channel: 'sms', senderKey, contactExternalId: theirNumber };
      touchedConversations.add(keyFor(convoKey));

      const mediaUrls = Array.isArray(sms.mediaUrls) ? (sms.mediaUrls as unknown as string[]) : [];
      const attachments = mediaUrls.map((key) => ({ kind: 'file' as const, key, mimeType: null, name: null }));
      const preview = (sms.body ?? '').slice(0, PREVIEW_MAX_CHARS) || (attachments.length > 0 ? '[adjunto]' : null);

      if (DRY_RUN) {
        created++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const conversation = await tx.inboxConversation.upsert({
          where: { tenantId_channel_senderKey_contactExternalId: convoKey },
          create: {
            tenantId: convoKey.tenantId,
            channel: 'sms',
            provider: 'twilio',
            senderKind: 'twilio_number',
            senderKey: convoKey.senderKey,
            twilioPhoneNumberId: convoKey.senderKey,
            contactExternalId: theirNumber,
            contactPhone: theirNumber,
            buyerId: sms.buyerId,
            status: 'open',
            unreadCount: 0,
          },
          update: sms.buyerId ? { buyer: { connect: { id: sms.buyerId } } } : {},
        });

        await tx.inboxMessage.create({
          data: {
            tenantId: sms.tenantId,
            conversationId: conversation.id,
            channel: 'sms',
            direction: sms.direction,
            body: sms.body,
            attachments: attachments as unknown as Prisma.InputJsonValue,
            status: sms.status,
            error: sms.errorMessage,
            sentById: sms.senderId,
            smsMessageId: sms.id,
            platformCreatedAt: sms.createdAt,
            deliveredAt: sms.deliveredAt,
          },
        });

        await tx.inboxConversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: sms.createdAt,
            lastMessagePreview: preview,
            lastDirection: sms.direction,
            ...(sms.direction === 'inbound' ? { lastInboundAt: sms.createdAt } : {}),
          },
        });
      });

      created++;
    }

    console.log(`  ...processed ${processed} (created ${created}, existing ${skippedExisting}, no-phone-match ${skippedNoPhone})`);
  }

  if (!DRY_RUN) {
    for (const rawKey of touchedConversations) {
      const [tenantId, , senderKey, contactExternalId] = rawKey.split('::');
      const conversation = await prisma.inboxConversation.findUnique({
        where: { tenantId_channel_senderKey_contactExternalId: { tenantId, channel: 'sms', senderKey, contactExternalId } },
        select: { id: true },
      });
      if (!conversation) continue;
      const unread = await prisma.smsMessage.count({
        where: { tenantId, direction: 'inbound', isRead: false, fromNumber: contactExternalId },
      });
      await prisma.inboxConversation.update({ where: { id: conversation.id }, data: { unreadCount: unread } });
    }
  }

  console.log(`Done. processed=${processed} created=${created} existing=${skippedExisting} noPhoneMatch=${skippedNoPhone} conversations=${touchedConversations.size}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
