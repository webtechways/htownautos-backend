import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { FavoriteType } from './dto/toggle-favorite.dto';

/** IAAI listing ids come as `iaai-<stock>` from the listing page, or the bare stock. */
const iaaiStock = (id: string) => id.replace(/^iaai-/, '');

@Injectable()
export class FavoritesService {
  constructor(
    private prisma: PrismaService,
  ) {}

  async addFavorite(
    tenantId: string,
    userId: string,
    listingId: string,
    type: FavoriteType,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (type === FavoriteType.COPART) {
      // Verify listing exists and get lotNumber
      const listing = await this.prisma.auctionListing.findUnique({
        where: { lotNumber: BigInt(listingId) },
        select: { lotNumber: true },
      });
      if (!listing) {
        throw new NotFoundException(`Auction listing with ID ${listingId} not found`);
      }

      // Create favorite using lotNumber (upsert to handle duplicates gracefully)
      const favorite = await this.prisma.auctionFavorite.upsert({
        where: {
          tenantId_userId_lotNumber: {
            tenantId,
            userId,
            lotNumber: listing.lotNumber,
          },
        },
        update: {},
        create: {
          tenantId,
          userId,
          lotNumber: listing.lotNumber,
        },
      });

      return { id: favorite.id, type, listingId, added: true };
    }

    if (type === FavoriteType.IAAI) {
      const stockNumber = iaaiStock(listingId);
      const listing = await this.prisma.iaaiListing.findUnique({ where: { stockNumber }, select: { stockNumber: true } });
      if (!listing) throw new NotFoundException(`IAAI lot ${stockNumber} not found`);
      const favorite = await this.prisma.iaaiFavorite.upsert({
        where: { tenantId_userId_stockNumber: { tenantId, userId, stockNumber } },
        update: {},
        create: { tenantId, userId, stockNumber },
      });
      return { id: favorite.id, type, listingId, added: true };
    }

    throw new BadRequestException(`Invalid favorite type: ${type}`);
  }

  async removeFavorite(
    tenantId: string,
    userId: string,
    listingId: string,
    type: FavoriteType,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    if (type === FavoriteType.COPART) {
      // Get lotNumber from listing
      const listing = await this.prisma.auctionListing.findUnique({
        where: { lotNumber: BigInt(listingId) },
        select: { lotNumber: true },
      });
      if (listing) {
        await this.prisma.auctionFavorite.deleteMany({
          where: {
            tenantId,
            userId,
            lotNumber: listing.lotNumber,
          },
        });
      }
      return { type, listingId, removed: true };
    }

    if (type === FavoriteType.IAAI) {
      await this.prisma.iaaiFavorite.deleteMany({ where: { tenantId, userId, stockNumber: iaaiStock(listingId) } });
      return { type, listingId, removed: true };
    }

    throw new BadRequestException(`Invalid favorite type: ${type}`);
  }

  async getFavoriteIds(
    tenantId: string,
    userId: string,
    type: FavoriteType,
  ): Promise<string[]> {
    if (!tenantId) {
      return [];
    }

    if (type === FavoriteType.COPART) {
      // Get favorite lotNumbers
      const favorites = await this.prisma.auctionFavorite.findMany({
        where: { tenantId, userId },
        select: { lotNumber: true },
      });

      if (favorites.length === 0) return [];

      // Get listing IDs for the favorite lotNumbers
      const lotNumbers = favorites.map((f) => f.lotNumber);
      const listings = await this.prisma.auctionListing.findMany({
        where: { lotNumber: { in: lotNumbers } },
        select: { lotNumber: true },
      });

      return listings.map((l) => l.lotNumber.toString());
    }

    if (type === FavoriteType.IAAI) {
      const favorites = await this.prisma.iaaiFavorite.findMany({ where: { tenantId, userId }, select: { stockNumber: true } });
      return favorites.map((f) => f.stockNumber);
    }

    return [];
  }

  async isFavorite(
    tenantId: string,
    userId: string,
    listingId: string,
    type: FavoriteType,
  ): Promise<boolean> {
    if (!tenantId) {
      return false;
    }

    if (type === FavoriteType.COPART) {
      // Get lotNumber from listing
      const listing = await this.prisma.auctionListing.findUnique({
        where: { lotNumber: BigInt(listingId) },
        select: { lotNumber: true },
      });
      if (!listing) return false;

      const favorite = await this.prisma.auctionFavorite.findUnique({
        where: {
          tenantId_userId_lotNumber: {
            tenantId,
            userId,
            lotNumber: listing.lotNumber,
          },
        },
      });
      return !!favorite;
    }

    if (type === FavoriteType.IAAI) {
      const favorite = await this.prisma.iaaiFavorite.findUnique({
        where: { tenantId_userId_stockNumber: { tenantId, userId, stockNumber: iaaiStock(listingId) } },
      });
      return !!favorite;
    }

    return false;
  }
}
