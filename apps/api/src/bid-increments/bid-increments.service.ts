import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import {
  DEFAULT_COPART_BID_INCREMENTS,
  normalizeBidIncrements,
  validateBidIncrements,
  type BidIncrementRow,
} from '@htownautos/common';

export interface BidIncrementTable {
  auction: string;
  rows: BidIncrementRow[];
  /** true si no hay filas guardadas y se devuelve la semilla. */
  isDefault: boolean;
  updatedAt: Date | null;
}

/**
 * Jumping Table por subasta, con cache hasta la siguiente escritura: la leen
 * los calculos de precio y cambia muy de vez en cuando.
 */
@Injectable()
export class BidIncrementsService {
  private cache = new Map<string, BidIncrementTable>();

  constructor(private readonly prisma: PrismaService) {}

  async get(auction = 'copart'): Promise<BidIncrementTable> {
    const hit = this.cache.get(auction);
    if (hit) return hit;

    const filas = await this.prisma.auctionBidIncrement.findMany({
      where: { auction },
      orderBy: { fromPrice: 'asc' },
    });
    const tabla: BidIncrementTable = filas.length
      ? {
          auction,
          rows: filas.map((f) => ({ fromPrice: Number(f.fromPrice), increment: Number(f.increment) })),
          isDefault: false,
          updatedAt: filas.reduce<Date | null>((m, f) => (!m || f.updatedAt > m ? f.updatedAt : m), null),
        }
      : { auction, rows: DEFAULT_COPART_BID_INCREMENTS, isDefault: true, updatedAt: null };
    this.cache.set(auction, tabla);
    return tabla;
  }

  /** Sustituye la tabla entera de una subasta. */
  async save(auction: string, rows: BidIncrementRow[], userId: string | null): Promise<BidIncrementTable> {
    const error = validateBidIncrements(rows);
    if (error) throw new BadRequestException(error);
    const limpias = normalizeBidIncrements(rows);

    await this.prisma.$transaction([
      this.prisma.auctionBidIncrement.deleteMany({ where: { auction } }),
      this.prisma.auctionBidIncrement.createMany({
        data: limpias.map((r) => ({
          auction,
          fromPrice: r.fromPrice,
          increment: r.increment,
          updatedById: userId,
        })),
      }),
    ]);
    this.cache.delete(auction);
    return this.get(auction);
  }
}
