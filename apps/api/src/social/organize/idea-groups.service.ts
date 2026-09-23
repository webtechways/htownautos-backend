import { Injectable, NotFoundException } from '@nestjs/common';
import { type SocialIdeaGroup } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { IdeaGroupInputDto, ReorderIdeaGroupsDto } from './dto';

const DEFAULT_GROUP_NAMES = ['To Do', 'In Progress', 'Done'];

export interface IdeaGroupView {
  id: string;
  name: string;
  position: number;
}

function toView(group: SocialIdeaGroup): IdeaGroupView {
  return { id: group.id, name: group.name, position: group.position };
}

@Injectable()
export class SocialIdeaGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** First call for a tenant creates To Do / In Progress / Done. */
  async list(tenantId: string): Promise<IdeaGroupView[]> {
    let rows = await this.prisma.socialIdeaGroup.findMany({ where: { tenantId }, orderBy: { position: 'asc' } });
    if (rows.length === 0) {
      await this.prisma.socialIdeaGroup.createMany({
        data: DEFAULT_GROUP_NAMES.map((name, i) => ({ tenantId, name, position: i })),
      });
      rows = await this.prisma.socialIdeaGroup.findMany({ where: { tenantId }, orderBy: { position: 'asc' } });
    }
    return rows.map(toView);
  }

  async create(tenantId: string, dto: IdeaGroupInputDto): Promise<IdeaGroupView> {
    const last = await this.prisma.socialIdeaGroup.findFirst({ where: { tenantId }, orderBy: { position: 'desc' } });
    const row = await this.prisma.socialIdeaGroup.create({ data: { tenantId, name: dto.name, position: (last?.position ?? -1) + 1 } });
    return toView(row);
  }

  async update(tenantId: string, id: string, dto: IdeaGroupInputDto): Promise<IdeaGroupView> {
    await this.ensureGroup(id, tenantId);
    const row = await this.prisma.socialIdeaGroup.update({ where: { id }, data: { name: dto.name } });
    return toView(row);
  }

  /** Deleting a group sets its ideas' groupId to null at the DB level (onDelete: SetNull) — no manual cleanup needed. */
  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    await this.ensureGroup(id, tenantId);
    await this.prisma.socialIdeaGroup.delete({ where: { id } });
    return { id };
  }

  async reorder(tenantId: string, dto: ReorderIdeaGroupsDto): Promise<IdeaGroupView[]> {
    const groups = await this.prisma.socialIdeaGroup.findMany({ where: { tenantId, id: { in: dto.ids } } });
    const byId = new Map(groups.map((g) => [g.id, g]));
    for (const id of dto.ids) {
      if (!byId.has(id)) throw new NotFoundException(`Grupo ${id} no encontrado`);
    }

    await this.prisma.$transaction(dto.ids.map((id, i) => this.prisma.socialIdeaGroup.update({ where: { id }, data: { position: i } })));
    return this.list(tenantId);
  }

  private async ensureGroup(id: string, tenantId: string): Promise<SocialIdeaGroup> {
    const group = await this.prisma.socialIdeaGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Grupo no encontrado');
    return group;
  }
}
