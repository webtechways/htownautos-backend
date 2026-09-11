import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { ChatNotifierService } from './chat-notifier.service';
import {
  preferenceToWhere,
  futureSaleWhere,
  WantedPreferenceCriteria,
} from '@htownautos/auction-matching';
import { loadAliasMaps } from './alias-maps.util';

/** How many lotNumbers to pack into a single `lotNumber IN (...)` clause. */
const LOT_IN_CHUNK = 1_000;

/** Lot fields surfaced in the notification payload (the "which cars" detail). */
const NOTIFY_LISTING_SELECT = {
  lotNumber: true,
  year: true,
  make: true,
  modelGroup: true,
  modelDetail: true,
  trim: true,
  vin: true,
  color: true,
  odometer: true,
  highBid: true,
  saleDate: true,
} satisfies Prisma.AuctionListingSelect;

type MatchedLot = {
  lotNumber: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  color: string | null;
  odometer: number | null;
  highBid: string | null;
  saleDate: number | null;
};

type BuyerGroup = {
  buyerId: string;
  tenantId: string;
  buyerName: string;
  lots: Map<string, MatchedLot>;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buyerDisplayName(b: {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  suffix: string | null;
  isBusinessBuyer: boolean;
  businessName: string | null;
}): string {
  if (b.isBusinessBuyer && b.businessName) return b.businessName;
  const name = [b.firstName, b.middleName, b.lastName, b.suffix]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || 'Customer';
}

/**
 * Cross-checks brand-new Copart lots against every buyer's wanted-vehicle
 * preferences and, for each buyer with at least one match, creates a
 * notification for every active staff user in that buyer's tenant.
 *
 * Runs in-process inside the data-sync worker right after the upsert (no
 * RabbitMQ / WebSocket dependency); delivery to the frontend is by polling the
 * `notifications` table.
 */

/** Cuantos coches se listan en el chat antes de resumir el resto. */
const MAX_EN_CHAT = 8;

/**
 * Ficha de cada coche para el cuerpo del mensaje.
 *
 * Se corta a los ocho porque Telegram tiene un tope por mensaje y una lista de
 * cuarenta coches no se lee en el movil de todas formas.
 */
function describeLots(
  lots: {
    lotNumber: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    vin: string | null;
    odometer: number | null;
  }[],
): string {
  const lineas = lots.slice(0, MAX_EN_CHAT).map((l) => {
    const titulo =
      [l.year, l.make, l.model, l.trim].filter(Boolean).join(' ').toUpperCase() ||
      `Lote ${l.lotNumber}`;
    const detalle = [
      l.vin ? `VIN ${l.vin}` : null,
      `Lote ${l.lotNumber}`,
      l.odometer != null ? `${l.odometer.toLocaleString('es-ES')} mi` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return `• ${titulo}\n  ${detalle}`;
  });
  const resto = lots.length - MAX_EN_CHAT;
  if (resto > 0) lineas.push(`…y ${resto} mas`);
  return lineas.join('\n');
}

@Injectable()
export class WantedMatchNotifierService {
  private readonly logger = new Logger(WantedMatchNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatNotifierService,
  ) {}

  /**
   * @param newLotNumberStrings lotNumbers (as strings) freshly inserted this run.
   * @returns the number of Notification rows created.
   */
  async notifyNewListings(newLotNumberStrings: string[]): Promise<number> {
    if (newLotNumberStrings.length === 0) return 0;

    const newLots = newLotNumberStrings.map((s) => BigInt(s));

    const prefs = await this.prisma.buyerVehiclePreference.findMany({
      select: {
        id: true,
        buyerId: true,
        tenantId: true,
        yearFrom: true,
        yearTo: true,
        make: true,
        models: true,
        trims: true,
        maxMileage: true,
        titleTypes: true,
        colors: true,
        maxCost: true,
        buyer: {
          select: {
            firstName: true,
            middleName: true,
            lastName: true,
            suffix: true,
            isBusinessBuyer: true,
            businessName: true,
            tenantId: true,
          },
        },
      },
    });
    if (prefs.length === 0) return 0;

    const lotChunks = chunk(newLots, LOT_IN_CHUNK);
    const future = futureSaleWhere();
    const aliasMaps = await loadAliasMaps(this.prisma);

    // buyerId → group of matched lots
    const byBuyer = new Map<string, BuyerGroup>();

    for (const pref of prefs) {
      const tenantId = pref.tenantId ?? pref.buyer.tenantId;
      if (!tenantId) continue; // can't scope a notification without a tenant

      const criteria: WantedPreferenceCriteria = {
        yearFrom: pref.yearFrom,
        yearTo: pref.yearTo,
        make: pref.make,
        models: pref.models,
        trims: pref.trims,
        maxMileage: pref.maxMileage,
        titleTypes: pref.titleTypes,
        colors: pref.colors,
        maxCost: pref.maxCost,
      };
      const prefWhere = preferenceToWhere(criteria, aliasMaps);

      for (const lots of lotChunks) {
        const listings = await this.prisma.auctionListing.findMany({
          where: {
            AND: [prefWhere, { lotNumber: { in: lots } }, future],
          },
          select: NOTIFY_LISTING_SELECT,
        });
        if (listings.length === 0) continue;

        let group = byBuyer.get(pref.buyerId);
        if (!group) {
          group = {
            buyerId: pref.buyerId,
            tenantId,
            buyerName: buyerDisplayName(pref.buyer),
            lots: new Map(),
          };
          byBuyer.set(pref.buyerId, group);
        }

        for (const l of listings) {
          const key = l.lotNumber.toString();
          if (group.lots.has(key)) continue; // dedupe across this buyer's prefs
          group.lots.set(key, {
            lotNumber: key,
            year: l.year,
            make: l.make,
            model: l.modelGroup ?? l.modelDetail,
            trim: l.trim,
            vin: l.vin,
            color: l.color,
            odometer: l.odometer != null ? Number(l.odometer) : null,
            highBid: l.highBid?.toString() ?? null,
            saleDate: l.saleDate,
          });
        }
      }
    }

    if (byBuyer.size === 0) return 0;

    // Resolve active staff per tenant once (a tenant can host many buyers).
    const staffByTenant = new Map<string, string[]>();
    const tenantIds = new Set(
      [...byBuyer.values()].map((g) => g.tenantId),
    );
    for (const tenantId of tenantIds) {
      const members = await this.prisma.tenantUser.findMany({
        where: { tenantId, isActive: true, status: 'active' },
        select: { userId: true },
      });
      staffByTenant.set(
        tenantId,
        [...new Set(members.map((m) => m.userId))],
      );
    }

    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const group of byBuyer.values()) {
      const staff = staffByTenant.get(group.tenantId) ?? [];
      if (staff.length === 0) continue;

      const lots = [...group.lots.values()];
      const count = lots.length;
      // Staff-facing message, in Spanish, to match the existing notification
      // producers (see portal.service CUSTOMER_FIND_A_CAR).
      const message =
        count === 1
          ? `${group.buyerName}: 1 auto nuevo coincide con su búsqueda`
          : `${group.buyerName}: ${count} autos nuevos coinciden con su búsqueda`;
      const actionUrl = `/dashboard/customers/${group.buyerId}/edit#for-bids-matches`;
      const meta: Prisma.InputJsonValue = {
        buyerId: group.buyerId,
        buyerName: group.buyerName,
        count,
        lots,
      };

      for (const userId of staff) {
        rows.push({
          tenantId: group.tenantId,
          userId,
          title: 'Coincidencia de subasta',
          message,
          type: 'AUCTION_WANTED_MATCH',
          entityType: 'buyer',
          entityId: group.buyerId,
          actionUrl,
          priority: 'normal',
          metaValue: meta,
        });
      }

      // Un mensaje por comprador, no por miembro del equipo: un aviso que va a
      // ocho personas no son ocho mensajes en el grupo de Telegram.
      //
      // Y con la ficha de cada coche: "3 autos coinciden" obliga a abrir el
      // dashboard para saber si merece la pena mirarlo.
      await this.chat.send({
        tenantId: group.tenantId,
        type: 'AUCTION_WANTED_MATCH',
        title: 'Coincidencia de subasta',
        message: `${message}\n\n${describeLots(lots)}`,
        actionUrl,
        priority: 'normal',
      });
    }

    if (rows.length === 0) return 0;

    const result = await this.prisma.notification.createMany({
      data: rows,
      skipDuplicates: true,
    });
    this.logger.log(
      `Wanted-match: ${byBuyer.size} buyer(s) matched → ${result.count} notification(s)`,
    );
    return result.count;
  }
}
