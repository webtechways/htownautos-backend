import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type SocialAccount, type SocialComment as PrismaSocialComment } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { SocialApiError, SocialTokenService, communityAdapterFor, type SocialPlatform } from '@htownautos/social';
import { CommentListQueryDto, CommentReplyDto } from './dto';
import { toCommentView, type SocialCommentView } from './mappers';
import { computeCommentScore } from './stats';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_LIMIT = 100;
const STATS_WINDOW_DAYS = 30;
const ROOT_LOOKUP_MAX_HOPS = 5;

type CommentWithAccount = PrismaSocialComment & { account: SocialAccount };

const COMMENT_WITH_ACCOUNT = { include: { account: true } } satisfies Prisma.SocialCommentDefaultArgs;

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CommentStats {
  open: number;
  done: number;
  commentScore: number;
  avgResponseMinutes: number | null;
}

export interface CommentThreadView {
  root: SocialCommentView;
  replies: SocialCommentView[];
}

/** Turns a platform-call failure into the 422 the contract promises for permission/validation errors, in Spanish. */
function toHttpError(err: unknown, platform: SocialPlatform): never {
  if (err instanceof SocialApiError) {
    if (err.kind === 'PERMISSION' || err.kind === 'AUTH' || err.kind === 'NOT_CONFIGURED' || err.kind === 'VALIDATION') {
      throw new UnprocessableEntityException(`${platform}: ${err.message}`);
    }
  }
  throw err;
}

@Injectable()
export class SocialCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SocialTokenService,
  ) {}

  async list(tenantId: string, query: CommentListQueryDto): Promise<Paginated<SocialCommentView>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? DEFAULT_PAGE_LIMIT, MAX_LIMIT);

    const where: Prisma.SocialCommentWhereInput = { tenantId, parentId: null };
    if (query.kind) where.kind = query.kind;
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.accountIds) where.accountId = { in: query.accountIds.split(',').filter(Boolean) };
    if (query.platform) where.platform = query.platform;
    if (query.postTargetId) where.postTargetId = query.postTargetId;
    if (query.q) where.body = { contains: query.q, mode: 'insensitive' };

    const [rows, total] = await Promise.all([
      this.prisma.socialComment.findMany({
        where,
        include: { account: true },
        orderBy: { platformCreatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.socialComment.count({ where }),
    ]);

    const replyCounts = await this.replyCountsFor(rows.map((r) => r.id));
    return {
      data: rows.map((r) => toCommentView(r, replyCounts.get(r.id) ?? 0)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async stats(tenantId: string): Promise<CommentStats> {
    const [open, done] = await Promise.all([
      this.prisma.socialComment.count({ where: { tenantId, parentId: null, status: 'open' } }),
      this.prisma.socialComment.count({ where: { tenantId, parentId: null, status: 'done' } }),
    ]);

    const since = new Date(Date.now() - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const recent = await this.prisma.socialComment.findMany({
      where: { tenantId, fromUs: false, platformCreatedAt: { gte: since } },
      select: { status: true, repliedAt: true, platformCreatedAt: true },
    });

    const { commentScore, avgResponseMinutes } = computeCommentScore(recent);
    return { open, done, commentScore, avgResponseMinutes };
  }

  async thread(tenantId: string, id: string): Promise<CommentThreadView> {
    const root = await this.ensureComment(id, tenantId);
    const replies = await this.prisma.socialComment.findMany({
      where: { tenantId, parentId: root.id },
      include: { account: true },
      orderBy: { platformCreatedAt: 'asc' },
    });
    const replyCounts = await this.replyCountsFor(replies.map((r) => r.id));
    return {
      root: toCommentView(root, await this.replyCountOf(root.id)),
      replies: replies.map((r) => toCommentView(r, replyCounts.get(r.id) ?? 0)),
    };
  }

  async reply(tenantId: string, id: string, dto: CommentReplyDto): Promise<SocialCommentView> {
    const comment = await this.ensureComment(id, tenantId);
    const platform = comment.platform as SocialPlatform;
    const adapter = communityAdapterFor(platform);
    if (!adapter?.reply) throw new UnprocessableEntityException(`${platform} no admite responder comentarios`);

    const accessToken = await this.tokens.getAccessToken(comment.account);
    const secrets = await this.tokens.getSecrets(comment.account);
    if (!secrets) throw new UnprocessableEntityException(`${platform}: cuenta sin credenciales — reconectar`);

    let result: { externalId: string; permalink: string | null };
    try {
      result = await adapter.reply({ account: comment.account, accessToken, secrets }, comment, dto.text);
    } catch (err) {
      toHttpError(err, platform);
    }

    // Some platforms (GBP reviews) reply against the SAME external id as the original — suffix ours to avoid the (accountId, externalId) collision.
    const replyExternalId = result.externalId === comment.externalId ? `${result.externalId}:reply:${Date.now()}` : result.externalId;

    const ourReply = await this.prisma.socialComment.create({
      data: {
        tenantId,
        accountId: comment.accountId,
        platform: comment.platform,
        kind: 'comment',
        status: 'done',
        externalId: replyExternalId,
        parentId: comment.id,
        externalParentId: comment.externalId,
        externalPostId: comment.externalPostId,
        postTargetId: comment.postTargetId,
        authorName: comment.account.name,
        authorHandle: comment.account.username,
        authorAvatarUrl: comment.account.avatarUrl,
        body: dto.text,
        permalink: result.permalink,
        fromUs: true,
        platformCreatedAt: new Date(),
      },
      include: { account: true },
    });

    await this.markRootReplied(comment.id);

    return toCommentView(ourReply, 0);
  }

  async like(tenantId: string, id: string): Promise<SocialCommentView> {
    return this.runAction(tenantId, id, 'like', async (adapter, ctx, comment) => {
      await adapter.like!(ctx, comment);
      return this.prisma.socialComment.update({ where: { id: comment.id }, data: { likedByUs: true }, include: { account: true } });
    });
  }

  async unlike(tenantId: string, id: string): Promise<SocialCommentView> {
    return this.runAction(tenantId, id, 'unlike', async (adapter, ctx, comment) => {
      await adapter.unlike!(ctx, comment);
      return this.prisma.socialComment.update({ where: { id: comment.id }, data: { likedByUs: false }, include: { account: true } });
    });
  }

  async hide(tenantId: string, id: string): Promise<SocialCommentView> {
    return this.runAction(tenantId, id, 'hide', async (adapter, ctx, comment) => {
      await adapter.hide!(ctx, comment);
      return this.prisma.socialComment.update({ where: { id: comment.id }, data: { isHidden: true }, include: { account: true } });
    });
  }

  async unhide(tenantId: string, id: string): Promise<SocialCommentView> {
    return this.runAction(tenantId, id, 'unhide', async (adapter, ctx, comment) => {
      await adapter.unhide!(ctx, comment);
      return this.prisma.socialComment.update({ where: { id: comment.id }, data: { isHidden: false }, include: { account: true } });
    });
  }

  async remove(tenantId: string, id: string): Promise<{ message: string }> {
    const comment = await this.ensureComment(id, tenantId);
    const platform = comment.platform as SocialPlatform;
    const adapter = communityAdapterFor(platform);
    if (!adapter?.delete) throw new UnprocessableEntityException(`${platform} no admite eliminar comentarios`);

    const accessToken = await this.tokens.getAccessToken(comment.account);
    const secrets = await this.tokens.getSecrets(comment.account);
    if (!secrets) throw new UnprocessableEntityException(`${platform}: cuenta sin credenciales — reconectar`);

    try {
      await adapter.delete({ account: comment.account, accessToken, secrets }, comment);
    } catch (err) {
      toHttpError(err, platform);
    }

    await this.prisma.socialComment.delete({ where: { id: comment.id } });
    return { message: 'Comentario eliminado' };
  }

  async patchStatus(tenantId: string, id: string, status: 'open' | 'done'): Promise<SocialCommentView> {
    await this.ensureComment(id, tenantId);
    const updated = await this.prisma.socialComment.update({ where: { id }, data: { status }, include: { account: true } });
    return toCommentView(updated, await this.replyCountOf(id));
  }

  async markDone(tenantId: string, ids: string[]): Promise<{ updated: number }> {
    const result = await this.prisma.socialComment.updateMany({
      where: { tenantId, id: { in: ids }, parentId: null },
      data: { status: 'done' },
    });
    return { updated: result.count };
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async runAction(
    tenantId: string,
    id: string,
    action: 'like' | 'unlike' | 'hide' | 'unhide',
    run: (
      adapter: NonNullable<ReturnType<typeof communityAdapterFor>>,
      ctx: { account: SocialAccount; accessToken: string; secrets: NonNullable<Awaited<ReturnType<SocialTokenService['getSecrets']>>> },
      comment: CommentWithAccount,
    ) => Promise<CommentWithAccount>,
  ): Promise<SocialCommentView> {
    const comment = await this.ensureComment(id, tenantId);
    const platform = comment.platform as SocialPlatform;
    const adapter = communityAdapterFor(platform);
    if (!adapter?.[action]) throw new UnprocessableEntityException(`${platform} no admite "${action}" en comentarios`);

    const accessToken = await this.tokens.getAccessToken(comment.account);
    const secrets = await this.tokens.getSecrets(comment.account);
    if (!secrets) throw new UnprocessableEntityException(`${platform}: cuenta sin credenciales — reconectar`);

    let updated: CommentWithAccount;
    try {
      updated = await run(adapter, { account: comment.account, accessToken, secrets }, comment);
    } catch (err) {
      toHttpError(err, platform);
    }

    return toCommentView(updated, await this.replyCountOf(updated.id));
  }

  private async ensureComment(id: string, tenantId: string): Promise<CommentWithAccount> {
    const comment = await this.prisma.socialComment.findFirst({ where: { id, tenantId }, ...COMMENT_WITH_ACCOUNT });
    if (!comment) throw new NotFoundException('Comentario no encontrado');
    return comment;
  }

  private async replyCountOf(id: string): Promise<number> {
    return this.prisma.socialComment.count({ where: { parentId: id } });
  }

  private async replyCountsFor(ids: string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const grouped = await this.prisma.socialComment.groupBy({ by: ['parentId'], where: { parentId: { in: ids } }, _count: { _all: true } });
    return new Map(grouped.filter((g) => g.parentId).map((g) => [g.parentId as string, g._count._all]));
  }

  /** Walks up `parentId` to the thread's root and marks it `done` + `repliedAt` (CONTRACT.md §3.6). */
  private async markRootReplied(startId: string): Promise<void> {
    let currentId = startId;
    for (let hop = 0; hop < ROOT_LOOKUP_MAX_HOPS; hop++) {
      const row = await this.prisma.socialComment.findUnique({ where: { id: currentId }, select: { id: true, parentId: true } });
      if (!row) return;
      if (!row.parentId) {
        await this.prisma.socialComment.update({ where: { id: row.id }, data: { status: 'done', repliedAt: new Date() } });
        return;
      }
      currentId = row.parentId;
    }
  }
}
