import type { Prisma, SocialStartPage } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { MediaResolverService } from '@htownautos/social';
import { resolveMediaMap } from '../posts/mappers';

export type StartBlockType = 'link' | 'header' | 'text' | 'image' | 'social' | 'video' | 'divider';

/** Verbatim shape of contract.ts `StartBlock`. */
export interface StartBlockView {
  id: string;
  type: StartBlockType;
  label?: string;
  url?: string;
  text?: string;
  mediaId?: string;
  imageUrl?: string | null;
  platform?: string;
  enabled: boolean;
}

/** Verbatim shape of contract.ts `StartTheme`. */
export interface StartThemeView {
  background: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  buttonStyle: 'filled' | 'outline' | 'soft';
  font: 'system' | 'serif' | 'mono' | 'rounded';
  avatarShape: 'circle' | 'square';
}

/** Verbatim shape of contract.ts `StartPage`. */
export interface StartPageView {
  id: string;
  slug: string;
  title: string;
  bio: string | null;
  avatarMediaId: string | null;
  avatarUrl: string | null;
  theme: StartThemeView;
  blocks: StartBlockView[];
  published: boolean;
  publicUrl: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_THEME: StartThemeView = {
  background: '#ffffff',
  textColor: '#111111',
  buttonColor: '#111111',
  buttonTextColor: '#ffffff',
  buttonStyle: 'filled',
  font: 'system',
  avatarShape: 'circle',
};

export function publicStartUrl(slug: string): string {
  const base = process.env.APP_BASE_URL || 'https://app.htownautos.com';
  return `${base}/start/${slug}`;
}

export function toTheme(json: Prisma.JsonValue | null | undefined): StartThemeView {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return DEFAULT_THEME;
  return { ...DEFAULT_THEME, ...(json as Partial<StartThemeView>) };
}

export function toBlocks(json: Prisma.JsonValue | null | undefined): StartBlockView[] {
  if (!Array.isArray(json)) return [];
  return json as unknown as StartBlockView[];
}

/** Resolves `avatarMediaId` + every block's `mediaId` into signed URLs in one shot (shared media-id batch resolver from `posts/mappers.ts`). */
export async function toStartPageView(
  prisma: PrismaService,
  resolver: MediaResolverService,
  tenantId: string,
  page: SocialStartPage,
): Promise<StartPageView> {
  const blocks = toBlocks(page.blocks);
  const mediaIds = [page.avatarMediaId, ...blocks.map((b) => b.mediaId)].filter((id): id is string => !!id);
  const mediaMap = await resolveMediaMap(prisma, resolver, tenantId, mediaIds);

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    bio: page.bio,
    avatarMediaId: page.avatarMediaId,
    avatarUrl: page.avatarMediaId ? (mediaMap.get(page.avatarMediaId)?.url ?? null) : null,
    theme: toTheme(page.theme),
    blocks: blocks.map((b) => ({ ...b, imageUrl: b.mediaId ? (mediaMap.get(b.mediaId)?.url ?? null) : null })),
    published: page.published,
    publicUrl: publicStartUrl(page.slug),
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}
