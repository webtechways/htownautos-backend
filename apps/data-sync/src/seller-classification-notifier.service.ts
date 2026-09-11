import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { ChatNotifierService } from './chat-notifier.service';
import { deriveSellerCategory } from '@htownautos/common';

/**
 * Above this many brand-new sellers in one run we treat it as a bulk/initial
 * load: still seed the classification table, but skip the staff notification so
 * the first big sync doesn't create an alarming "N sellers to classify" ping.
 */
const SELLER_NOTIFY_LIMIT = 100;

function sellerKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Keeps the AuctionSellerClassification table in sync with the sellers present in
 * the auction data. Any seller not yet in the table is seeded as
 * `reviewed=false` (with a derived category suggestion) and — for reasonably
 * sized batches — staff get a notification to classify it in Settings → Sellers.
 * The seeded row is the dedupe: a seller is only ever "new" once.
 *
 * Runs in-process inside the data-sync worker after the upsert, mirroring
 * WantedMatchNotifierService. Delivery is by polling the `notifications` table.
 */
@Injectable()
export class SellerClassificationNotifierService {
  private readonly logger = new Logger(SellerClassificationNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatNotifierService,
  ) {}

  /** @returns the number of brand-new sellers seeded this run. */
  async seedAndNotify(): Promise<number> {
    // Distinct sellers currently in the data.
    const grouped = await this.prisma.auctionListing.groupBy({
      by: ['sellerName'],
      where: { sellerName: { not: null } },
    });
    // Collapse to unique keys, keeping a display name per key.
    const byKey = new Map<string, string>();
    for (const g of grouped) {
      const name = g.sellerName as string;
      if (!name || !name.trim()) continue;
      const key = sellerKey(name);
      if (!byKey.has(key)) byKey.set(key, name.trim());
    }

    // Which keys do we already track?
    const existing = await this.prisma.auctionSellerClassification.findMany({
      select: { sellerKey: true },
    });
    const known = new Set(existing.map((e) => e.sellerKey));

    const newKeys = [...byKey.keys()].filter((k) => !known.has(k));
    if (newKeys.length === 0) return 0;

    // Seed the new sellers (reviewed=false, derived category suggestion).
    const seedRows: Prisma.AuctionSellerClassificationCreateManyInput[] =
      newKeys.map((key) => {
        const name = byKey.get(key) as string;
        return {
          sellerKey: key,
          sellerName: name,
          category: deriveSellerCategory(null, name),
          trusted: false,
          reviewed: false,
        };
      });
    await this.prisma.auctionSellerClassification.createMany({
      data: seedRows,
      skipDuplicates: true,
    });
    this.logger.log(`Seeded ${newKeys.length} new seller(s) for classification`);

    // Bulk/initial load → seed silently, no staff ping.
    if (newKeys.length > SELLER_NOTIFY_LIMIT) {
      this.logger.warn(
        `Skipping seller-classification notifications: ${newKeys.length} new ` +
          `sellers exceeds threshold of ${SELLER_NOTIFY_LIMIT} (bulk/initial load)`,
      );
      return newKeys.length;
    }

    // Notify active staff across all tenants (the classification is global).
    const members = await this.prisma.tenantUser.findMany({
      where: { isActive: true, status: 'active' },
      select: { tenantId: true, userId: true },
    });
    if (members.length === 0) return newKeys.length;

    const count = newKeys.length;
    const sample = newKeys.slice(0, 10).map((k) => byKey.get(k) ?? k);
    const message =
      count === 1
        ? `1 vendedor nuevo requiere clasificación`
        : `${count} vendedores nuevos requieren clasificación`;
    const meta: Prisma.InputJsonValue = { count, sample };

    const rows: Prisma.NotificationCreateManyInput[] = members.map((m) => ({
      tenantId: m.tenantId,
      userId: m.userId,
      title: 'Vendedores por clasificar',
      message,
      type: 'SELLER_NEEDS_CLASSIFICATION',
      entityType: 'seller',
      actionUrl: '/dashboard/settings/sellers?review=1',
      priority: 'normal',
      metaValue: meta,
    }));

    const result = await this.prisma.notification.createMany({
      data: rows,
      skipDuplicates: true,
    });

    // Un mensaje por tenant, no por miembro: `members` trae una fila por
    // persona y mandar uno por cada una llenaria el grupo de duplicados.
    for (const tenantId of new Set(members.map((m) => m.tenantId))) {
      await this.chat.send({
        tenantId,
        type: 'SELLER_NEEDS_CLASSIFICATION',
        title: 'Vendedores por clasificar',
        message: sample.length
          ? `${message}\n\n${sample.map((s: string) => `• ${s}`).join('\n')}`
          : message,
        actionUrl: '/dashboard/settings/sellers?review=1',
        priority: 'normal',
      });
    }

    this.logger.log(
      `Seller-classification: ${count} new seller(s) → ${result.count} notification(s)`,
    );
    return newKeys.length;
  }
}
