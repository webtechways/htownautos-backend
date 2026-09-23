import type { Prisma } from '@prisma/client';
import { toUserSummary, type SocialMediaItemView, type UserSummaryView } from '../posts/mappers';

/** One place every SocialIdea query builds its `include` from. */
export const IDEA_INCLUDE = {
  tags: true,
  createdBy: { include: { user: { select: { id: true, name: true, email: true, avatar: true } } } },
} satisfies Prisma.SocialIdeaInclude;

export type IdeaWithRelations = Prisma.SocialIdeaGetPayload<{ include: typeof IDEA_INCLUDE }>;

export interface SocialIdeaView {
  id: string;
  groupId: string | null;
  title: string;
  content: string;
  mediaIds: string[];
  media: SocialMediaItemView[];
  tags: { id: string; name: string; color: string }[];
  position: number;
  sourceUrl: string | null;
  createdBy: UserSummaryView | null;
  createdAt: string;
  updatedAt: string;
}

export function toIdeaView(idea: IdeaWithRelations, mediaMap: Map<string, SocialMediaItemView>): SocialIdeaView {
  return {
    id: idea.id,
    groupId: idea.groupId,
    title: idea.title,
    content: idea.content,
    mediaIds: idea.mediaIds,
    media: idea.mediaIds.map((id) => mediaMap.get(id)).filter((m): m is SocialMediaItemView => !!m),
    tags: idea.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    position: idea.position,
    sourceUrl: idea.sourceUrl,
    createdBy: toUserSummary(idea.createdBy),
    createdAt: idea.createdAt.toISOString(),
    updatedAt: idea.updatedAt.toISOString(),
  };
}
