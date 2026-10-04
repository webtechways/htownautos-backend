import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { CreateListingGroupDto, UpdateListingGroupDto } from './dto/create-listing-group.dto';

const isIaai = (auction?: string) => auction?.toLowerCase() === 'iaai';
const stockOf = (id: string) => id.replace(/^iaai-/, '');

@Injectable()
export class ListingGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.auctionListingGroup.findMany({
      where: { tenantId },
      include: { _count: { select: { items: true, iaaiItems: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateListingGroupDto) {
    try {
      return await this.prisma.auctionListingGroup.create({
        data: { tenantId, userId, name: dto.name, description: dto.description },
        include: { _count: { select: { items: true, iaaiItems: true } } },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(`A group named "${dto.name}" already exists`);
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateListingGroupDto) {
    const group = await this.prisma.auctionListingGroup.findFirst({
      where: { id, tenantId },
    });
    if (!group) throw new NotFoundException('Group not found');

    return this.prisma.auctionListingGroup.update({
      where: { id },
      data: { ...dto },
      include: { _count: { select: { items: true, iaaiItems: true } } },
    });
  }

  async remove(tenantId: string, id: string) {
    const group = await this.prisma.auctionListingGroup.findFirst({
      where: { id, tenantId },
    });
    if (!group) throw new NotFoundException('Group not found');

    await this.prisma.auctionListingGroup.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * `auction = 'iaai'` works on the group's IAAI lots (stock numbers, own
   * table). A group is shared: it can hold Copart and IAAI lots at once.
   */
  async getItems(tenantId: string, groupId: string, auction?: string) {
    const group = await this.prisma.auctionListingGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) throw new NotFoundException('Group not found');

    if (isIaai(auction)) {
      const rows = await this.prisma.auctionListingGroupIaaiItem.findMany({ where: { groupId }, select: { stockNumber: true } });
      return { groupId, lotNumbers: rows.map((r) => r.stockNumber) };
    }

    const items = await this.prisma.auctionListingGroupItem.findMany({
      where: { groupId },
      select: { lotNumber: true },
    });

    return { groupId, lotNumbers: items.map((i) => i.lotNumber.toString()) };
  }

  async addItems(tenantId: string, groupId: string, lotNumbers: string[], auction?: string) {
    const group = await this.prisma.auctionListingGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) throw new NotFoundException('Group not found');

    if (isIaai(auction)) {
      const stocks = lotNumbers.map(stockOf);
      // Only lots that exist: the FK would reject the whole batch otherwise.
      const known = await this.prisma.iaaiListing.findMany({ where: { stockNumber: { in: stocks } }, select: { stockNumber: true } });
      const r = await this.prisma.auctionListingGroupIaaiItem.createMany({
        data: known.map((k) => ({ groupId, stockNumber: k.stockNumber })),
        skipDuplicates: true,
      });
      return { added: r.count };
    }

    const result = await this.prisma.auctionListingGroupItem.createMany({
      data: lotNumbers.map((ln) => ({ groupId, lotNumber: BigInt(ln) })),
      skipDuplicates: true,
    });

    return { added: result.count };
  }

  async removeItem(tenantId: string, groupId: string, lotNumber: string, auction?: string) {
    const group = await this.prisma.auctionListingGroup.findFirst({
      where: { id: groupId, tenantId },
    });
    if (!group) throw new NotFoundException('Group not found');

    if (isIaai(auction)) {
      await this.prisma.auctionListingGroupIaaiItem.deleteMany({ where: { groupId, stockNumber: stockOf(lotNumber) } });
      return { removed: true };
    }

    await this.prisma.auctionListingGroupItem.delete({
      where: { groupId_lotNumber: { groupId, lotNumber: BigInt(lotNumber) } },
    }).catch(() => {});

    return { removed: true };
  }

  async getGroupsForLot(tenantId: string, lotNumber: string, auction?: string) {
    if (isIaai(auction)) {
      const rows = await this.prisma.auctionListingGroupIaaiItem.findMany({
        where: { stockNumber: stockOf(lotNumber), group: { tenantId } },
        include: { group: { select: { id: true, name: true } } },
      });
      return { groups: rows.map((r) => r.group), count: rows.length };
    }
    const items = await this.prisma.auctionListingGroupItem.findMany({
      where: {
        lotNumber: BigInt(lotNumber),
        group: { tenantId },
      },
      include: { group: { select: { id: true, name: true } } },
    });

    return {
      groups: items.map((i) => i.group),
      count: items.length,
    };
  }
}
