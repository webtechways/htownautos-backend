import { Injectable, NotFoundException } from '@nestjs/common';
import { type SocialHashtagGroup } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { CreateHashtagGroupDto, UpdateHashtagGroupDto } from './dto';

export interface HashtagGroupView {
  id: string;
  name: string;
  hashtags: string;
}

function toView(group: SocialHashtagGroup): HashtagGroupView {
  return { id: group.id, name: group.name, hashtags: group.hashtags };
}

@Injectable()
export class SocialHashtagGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<HashtagGroupView[]> {
    const rows = await this.prisma.socialHashtagGroup.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
    return rows.map(toView);
  }

  async create(tenantId: string, dto: CreateHashtagGroupDto): Promise<HashtagGroupView> {
    const row = await this.prisma.socialHashtagGroup.create({ data: { tenantId, name: dto.name, hashtags: dto.hashtags } });
    return toView(row);
  }

  async update(tenantId: string, id: string, dto: UpdateHashtagGroupDto): Promise<HashtagGroupView> {
    await this.ensureGroup(id, tenantId);
    const row = await this.prisma.socialHashtagGroup.update({
      where: { id },
      data: { ...(dto.name !== undefined && { name: dto.name }), ...(dto.hashtags !== undefined && { hashtags: dto.hashtags }) },
    });
    return toView(row);
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    await this.ensureGroup(id, tenantId);
    await this.prisma.socialHashtagGroup.delete({ where: { id } });
    return { id };
  }

  private async ensureGroup(id: string, tenantId: string): Promise<SocialHashtagGroup> {
    const group = await this.prisma.socialHashtagGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Grupo de hashtags no encontrado');
    return group;
  }
}
