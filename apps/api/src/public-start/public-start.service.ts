import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { MediaResolverService } from '@htownautos/social';
import { toBlocks, toTheme, type StartBlockView, type StartThemeView } from '../social/start-pages/mappers';
import { StartPageEventDto } from './dto';

/** Public pages are read by strangers who may keep the tab open a while — 24h signed URLs instead of the usual ~1h default (CONTRACT.md §3.9). */
const PUBLIC_MEDIA_TTL_SEC = 24 * 60 * 60;

/** Verbatim shape of contract.ts `PublicStartPage`. */
export interface PublicStartPageView {
  slug: string;
  title: string;
  bio: string | null;
  avatarUrl: string | null;
  theme: StartThemeView;
  blocks: StartBlockView[];
}

@Injectable()
export class PublicStartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaResolver: MediaResolverService,
  ) {}

  async getBySlug(slug: string): Promise<PublicStartPageView> {
    const page = await this.prisma.socialStartPage.findUnique({ where: { slug } });
    if (!page || !page.published) throw new NotFoundException('Página no encontrada');

    const blocks = toBlocks(page.blocks).filter((b) => b.enabled);
    const mediaIds = [page.avatarMediaId, ...blocks.map((b) => b.mediaId)].filter((id): id is string => !!id);
    const urlMap = await this.resolveSignedUrls(page.tenantId, mediaIds);

    return {
      slug: page.slug,
      title: page.title,
      bio: page.bio,
      avatarUrl: page.avatarMediaId ? (urlMap.get(page.avatarMediaId) ?? null) : null,
      theme: toTheme(page.theme),
      blocks: blocks.map((b) => ({ ...b, imageUrl: b.mediaId ? (urlMap.get(b.mediaId) ?? null) : null })),
    };
  }

  /** Daily upsert-increment into `SocialStartPageStat` (not one row per event, CONTRACT.md §3.9). */
  async recordEvent(slug: string, dto: StartPageEventDto): Promise<void> {
    const page = await this.prisma.socialStartPage.findUnique({ where: { slug } });
    if (!page || !page.published) throw new NotFoundException('Página no encontrada');

    let blockId = '';
    if (dto.type === 'click') {
      if (!dto.blockId) throw new BadRequestException('blockId requerido para un evento de click');
      const belongs = toBlocks(page.blocks).some((b) => b.id === dto.blockId);
      if (!belongs) throw new BadRequestException('blockId no pertenece a esta página');
      blockId = dto.blockId;
    }

    const today = new Date(new Date().toISOString().slice(0, 10));
    await this.prisma.socialStartPageStat.upsert({
      where: { pageId_date_blockId: { pageId: page.id, date: today, blockId } },
      create: {
        tenantId: page.tenantId,
        pageId: page.id,
        date: today,
        blockId,
        views: dto.type === 'view' ? 1 : 0,
        clicks: dto.type === 'click' ? 1 : 0,
      },
      update: {
        ...(dto.type === 'view' ? { views: { increment: 1 } } : {}),
        ...(dto.type === 'click' ? { clicks: { increment: 1 } } : {}),
      },
    });
  }

  private async resolveSignedUrls(tenantId: string, mediaIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = Array.from(new Set(mediaIds));
    if (uniqueIds.length === 0) return new Map();

    const rows = await this.prisma.socialMedia.findMany({ where: { id: { in: uniqueIds }, tenantId } });
    const entries = await Promise.all(rows.map(async (row): Promise<[string, string]> => [row.id, await this.mediaResolver.signedUrl(row, PUBLIC_MEDIA_TTL_SEC)]));
    return new Map(entries);
  }
}
