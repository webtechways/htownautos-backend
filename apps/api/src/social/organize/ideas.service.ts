import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import type { AuthenticatedUser } from '@htownautos/auth';
import { MediaResolverService } from '@htownautos/social';
import { resolveMediaMap } from '../posts/mappers';
import { CreateIdeaDto, IdeaListQueryDto, MoveIdeaDto, UpdateIdeaDto } from './dto';
import { IDEA_INCLUDE, toIdeaView, type IdeaWithRelations, type SocialIdeaView } from './idea-view';

const UNASSIGNED = 'unassigned';

@Injectable()
export class SocialIdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: MediaResolverService,
  ) {}

  async list(tenantId: string, query: IdeaListQueryDto): Promise<SocialIdeaView[]> {
    const where: Prisma.SocialIdeaWhereInput = { tenantId };
    if (query.groupId === UNASSIGNED) where.groupId = null;
    else if (query.groupId) where.groupId = query.groupId;
    if (query.tagIds) {
      const ids = query.tagIds.split(',').filter(Boolean);
      if (ids.length) where.tags = { some: { id: { in: ids } } };
    }
    if (query.q) {
      where.OR = [{ title: { contains: query.q, mode: 'insensitive' } }, { content: { contains: query.q, mode: 'insensitive' } }];
    }

    const rows = await this.prisma.socialIdea.findMany({ where, include: IDEA_INCLUDE, orderBy: { position: 'asc' } });
    const mediaMap = await resolveMediaMap(this.prisma, this.resolver, tenantId, rows.flatMap((r) => r.mediaIds));
    return rows.map((r) => toIdeaView(r, mediaMap));
  }

  async create(tenantId: string, user: AuthenticatedUser, dto: CreateIdeaDto): Promise<SocialIdeaView> {
    if (dto.groupId) await this.ensureGroup(dto.groupId, tenantId);
    const tagIds = await this.validateTagIds(tenantId, dto.tagIds);
    const mediaIds = await this.validateMediaIds(tenantId, dto.mediaIds);
    const createdById = await this.resolveTenantUserId(user.id, tenantId);
    const position = dto.position ?? (await this.nextPosition(tenantId, dto.groupId ?? null));

    const row = await this.prisma.socialIdea.create({
      data: {
        tenantId,
        groupId: dto.groupId ?? null,
        title: dto.title,
        content: dto.content ?? '',
        mediaIds,
        position,
        sourceUrl: dto.sourceUrl,
        createdById,
        tags: tagIds.length ? { connect: tagIds.map((id) => ({ id })) } : undefined,
      },
      include: IDEA_INCLUDE,
    });
    const mediaMap = await resolveMediaMap(this.prisma, this.resolver, tenantId, row.mediaIds);
    return toIdeaView(row, mediaMap);
  }

  async update(tenantId: string, id: string, dto: UpdateIdeaDto): Promise<SocialIdeaView> {
    await this.ensureIdea(id, tenantId);
    if (dto.groupId) await this.ensureGroup(dto.groupId, tenantId);
    const tagIds = dto.tagIds !== undefined ? await this.validateTagIds(tenantId, dto.tagIds) : undefined;
    const mediaIds = dto.mediaIds !== undefined ? await this.validateMediaIds(tenantId, dto.mediaIds) : undefined;

    const row = await this.prisma.socialIdea.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(mediaIds !== undefined && { mediaIds }),
        ...(dto.groupId !== undefined && { groupId: dto.groupId }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.sourceUrl !== undefined && { sourceUrl: dto.sourceUrl }),
        ...(tagIds !== undefined && { tags: { set: tagIds.map((tid) => ({ id: tid })) } }),
      },
      include: IDEA_INCLUDE,
    });
    const mediaMap = await resolveMediaMap(this.prisma, this.resolver, tenantId, row.mediaIds);
    return toIdeaView(row, mediaMap);
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    await this.ensureIdea(id, tenantId);
    await this.prisma.socialIdea.delete({ where: { id } });
    return { id };
  }

  async move(tenantId: string, id: string, dto: MoveIdeaDto): Promise<SocialIdeaView> {
    await this.ensureIdea(id, tenantId);
    if (dto.groupId) await this.ensureGroup(dto.groupId, tenantId);

    const row = await this.prisma.socialIdea.update({
      where: { id },
      data: { groupId: dto.groupId, position: dto.position },
      include: IDEA_INCLUDE,
    });
    const mediaMap = await resolveMediaMap(this.prisma, this.resolver, tenantId, row.mediaIds);
    return toIdeaView(row, mediaMap);
  }

  private async nextPosition(tenantId: string, groupId: string | null): Promise<number> {
    const last = await this.prisma.socialIdea.findFirst({ where: { tenantId, groupId }, orderBy: { position: 'desc' } });
    return (last?.position ?? -1) + 1;
  }

  private async validateTagIds(tenantId: string, tagIds: string[] | undefined): Promise<string[]> {
    if (!tagIds || tagIds.length === 0) return [];
    const rows = await this.prisma.socialTag.findMany({ where: { tenantId, id: { in: tagIds } }, select: { id: true } });
    if (rows.length !== tagIds.length) throw new NotFoundException('Alguna etiqueta no existe');
    return tagIds;
  }

  private async validateMediaIds(tenantId: string, mediaIds: string[] | undefined): Promise<string[]> {
    if (!mediaIds || mediaIds.length === 0) return [];
    const rows = await this.prisma.socialMedia.findMany({ where: { tenantId, id: { in: mediaIds } }, select: { id: true } });
    if (rows.length !== mediaIds.length) throw new NotFoundException('Algún archivo no existe');
    return mediaIds;
  }

  private async ensureGroup(groupId: string, tenantId: string): Promise<void> {
    const group = await this.prisma.socialIdeaGroup.findFirst({ where: { id: groupId, tenantId } });
    if (!group) throw new NotFoundException('Grupo no encontrado');
  }

  private async ensureIdea(id: string, tenantId: string): Promise<IdeaWithRelations> {
    const idea = await this.prisma.socialIdea.findFirst({ where: { id, tenantId }, include: IDEA_INCLUDE });
    if (!idea) throw new NotFoundException('Idea no encontrada');
    return idea;
  }

  private async resolveTenantUserId(userId: string, tenantId: string): Promise<string | null> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    return tenantUser?.id ?? null;
  }
}
