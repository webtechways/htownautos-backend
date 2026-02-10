import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FavoriteType } from './dto/toggle-favorite.dto';

@Injectable()
export class FavoritesService {
  constructor(private prisma: PrismaService) {}

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
      // Verify listing exists
      const listing = await this.prisma.copartListing.findUnique({
        where: { id: listingId },
      });
      if (!listing) {
        throw new NotFoundException(`Copart listing with ID ${listingId} not found`);
      }

      // Create favorite (upsert to handle duplicates gracefully)
      const favorite = await this.prisma.copartFavorite.upsert({
        where: {
          tenantId_userId_copartListingId: {
            tenantId,
            userId,
            copartListingId: listingId,
          },
        },
        update: {},
        create: {
          tenantId,
          userId,
          copartListingId: listingId,
        },
      });

      return { id: favorite.id, type, listingId, added: true };
    } else if (type === FavoriteType.SCA_AUCTION) {
      // Verify listing exists
      const listing = await this.prisma.marketCheckAuctionListing.findUnique({
        where: { id: listingId },
      });
      if (!listing) {
        throw new NotFoundException(`SCA Auction listing with ID ${listingId} not found`);
      }

      // Create favorite (upsert to handle duplicates gracefully)
      const favorite = await this.prisma.scaAuctionFavorite.upsert({
        where: {
          tenantId_userId_scaAuctionListingId: {
            tenantId,
            userId,
            scaAuctionListingId: listingId,
          },
        },
        update: {},
        create: {
          tenantId,
          userId,
          scaAuctionListingId: listingId,
        },
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
      await this.prisma.copartFavorite.deleteMany({
        where: {
          tenantId,
          userId,
          copartListingId: listingId,
        },
      });
      return { type, listingId, removed: true };
    } else if (type === FavoriteType.SCA_AUCTION) {
      await this.prisma.scaAuctionFavorite.deleteMany({
        where: {
          tenantId,
          userId,
          scaAuctionListingId: listingId,
        },
      });
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
      const favorites = await this.prisma.copartFavorite.findMany({
        where: { tenantId, userId },
        select: { copartListingId: true },
      });
      return favorites.map((f) => f.copartListingId);
    } else if (type === FavoriteType.SCA_AUCTION) {
      const favorites = await this.prisma.scaAuctionFavorite.findMany({
        where: { tenantId, userId },
        select: { scaAuctionListingId: true },
      });
      return favorites.map((f) => f.scaAuctionListingId);
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
      const favorite = await this.prisma.copartFavorite.findUnique({
        where: {
          tenantId_userId_copartListingId: {
            tenantId,
            userId,
            copartListingId: listingId,
          },
        },
      });
      return !!favorite;
    } else if (type === FavoriteType.SCA_AUCTION) {
      const favorite = await this.prisma.scaAuctionFavorite.findUnique({
        where: {
          tenantId_userId_scaAuctionListingId: {
            tenantId,
            userId,
            scaAuctionListingId: listingId,
          },
        },
      });
      return !!favorite;
    }

    return false;
  }
}
