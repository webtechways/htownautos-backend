import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { ChatNotifierService } from './chat-notifier.service';
import { CANONICAL_FIELDS, normalizeToken, type CanonicalField } from '@htownautos/common';

/** Above this many brand-new values in one run, seed silently (bulk/initial). */
const ALIAS_NOTIFY_LIMIT = 200;

const FIELD_COLUMN: Record<CanonicalField, 'make' | 'modelGroup' | 'trim' | 'color'> = {
  make: 'make',
  model: 'modelGroup',
  trim: 'trim',
  color: 'color',
};

/**
 * Keeps `auction_value_aliases` in sync with the distinct (normalized) make /
 * model / trim / color values in the data. New values are seeded reviewed=false
 * (canonical = identity) and — for reasonable batches — staff get a notification
 * to review/merge them in Settings → Vehicle Data. The seeded row is the dedupe.
 * Mirrors SellerClassificationNotifierService.
 */
@Injectable()
export class AuctionAliasNotifierService {
  private readonly logger = new Logger(AuctionAliasNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatNotifierService,
  ) {}

  private async distinctNormalized(field: CanonicalField): Promise<Set<string>> {
    const col = FIELD_COLUMN[field];
    const rows = (await this.prisma.auctionListing.groupBy({
      by: [col],
      where: { isStale: false, [col]: { not: null } },
    } as never)) as Array<Record<string, unknown>>;
    const set = new Set<string>();
    for (const r of rows) {
      const norm = normalizeToken(r[col] as string | null);
      if (norm) set.add(norm);
    }
    return set;
  }

  /** @returns number of brand-new values seeded this run. */
  async seedAndNotify(): Promise<number> {
    const existing = await this.prisma.auctionValueAlias.findMany({
      select: { field: true, aliasKey: true },
    });
    const known = new Set(existing.map((e) => `${e.field}:${e.aliasKey}`));

    const seed: Prisma.AuctionValueAliasCreateManyInput[] = [];
    const newByField: Partial<Record<CanonicalField, number>> = {};

    for (const field of CANONICAL_FIELDS) {
      const values = await this.distinctNormalized(field);
      let count = 0;
      for (const v of values) {
        if (known.has(`${field}:${v}`)) continue;
        seed.push({ field, aliasKey: v, canonical: v, reviewed: false });
        count++;
      }
      if (count > 0) newByField[field] = count;
    }

    if (seed.length === 0) return 0;
    await this.prisma.auctionValueAlias.createMany({ data: seed, skipDuplicates: true });
    const total = seed.length;
    this.logger.log(`Seeded ${total} new filter value(s) for review`);

    if (total > ALIAS_NOTIFY_LIMIT) {
      this.logger.warn(
        `Skipping alias-review notifications: ${total} new values exceeds ` +
          `threshold of ${ALIAS_NOTIFY_LIMIT} (bulk/initial load)`,
      );
      return total;
    }

    const members = await this.prisma.tenantUser.findMany({
      where: { isActive: true, status: 'active' },
      select: { tenantId: true, userId: true },
    });
    if (members.length === 0) return total;

    const parts = Object.entries(newByField).map(([f, n]) => `${n} ${f}`);
    const message = `${total} valores de filtro nuevos por revisar (${parts.join(', ')})`;
    const meta: Prisma.InputJsonValue = { counts: newByField };

    const rows: Prisma.NotificationCreateManyInput[] = members.map((m) => ({
      tenantId: m.tenantId,
      userId: m.userId,
      title: 'Valores por revisar',
      message,
      type: 'ALIAS_NEEDS_REVIEW',
      entityType: 'auction_value',
      actionUrl: '/dashboard/settings/vehicle-data?review=1',
      priority: 'normal',
      metaValue: meta,
    }));

    const result = await this.prisma.notification.createMany({
      data: rows,
      skipDuplicates: true,
    });

    // Un mensaje por tenant, no por miembro del equipo.
    for (const tenantId of new Set(members.map((m) => m.tenantId))) {
      await this.chat.send({
        tenantId,
        type: 'ALIAS_NEEDS_REVIEW',
        title: 'Valores por revisar',
        message,
        actionUrl: '/dashboard/settings/vehicle-data?review=1',
        priority: 'low',
      });
    }

    this.logger.log(
      `Alias-review: ${total} new value(s) → ${result.count} notification(s)`,
    );
    return total;
  }
}
