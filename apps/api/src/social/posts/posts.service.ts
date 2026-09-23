import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type SocialAccount as PrismaSocialAccount } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import type { AuthenticatedUser } from '@htownautos/auth';
import { RabbitMQService } from '@htownautos/rabbitmq';
import {
  MediaResolverService,
  SocialNotifierService,
  SocialRealtimeService,
  SOCIAL_PUBLISH_QUEUE,
  type MediaKind,
  type PublishablePlatform,
} from '@htownautos/social';
import { SocialAccessService } from '../settings/social-access.service';
import { CreatePostDto, MarkPublishedDto, PostListQueryDto, RejectDto, RescheduleDto, UpdatePostDto } from './dto';
import { resolveMediaMap, type PlatformOptionsView } from './mappers';
import { collectMediaIds, POST_INCLUDE, toPostView, type PostWithRelations, type ScheduleMode, type SocialPostView } from './post-view';
import { recomputePostStatus, type TargetStatus } from './post-status';
import { SocialSchedulingService, type Db } from './scheduling.service';
import { throwIfInvalid, validateTarget, type FieldError } from './validation';

const DEFAULT_PAGE_LIMIT = 20;
const MAX_LIMIT_WITHOUT_RANGE = 100;
const TERMINAL_TARGET_STATUSES = new Set(['published', 'publishing', 'cancelled']);
const QUEUE_TAB_STATUSES = ['scheduled', 'publishing', 'failed'] as const;
const SENT_TAB_STATUSES = ['published', 'partial'] as const;

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class SocialPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: MediaResolverService,
    private readonly access: SocialAccessService,
    private readonly notifier: SocialNotifierService,
    private readonly realtime: SocialRealtimeService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly scheduling: SocialSchedulingService,
  ) {}

  // ─── list / read ────────────────────────────────────────────────────────

  async list(tenantId: string, query: PostListQueryDto): Promise<Paginated<SocialPostView>> {
    const page = query.page ?? 1;
    const hasRange = !!(query.from || query.to);
    let limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    if (!hasRange) limit = Math.min(limit, MAX_LIMIT_WITHOUT_RANGE);

    let rows: PostWithRelations[];
    let total: number;

    if (query.tab === 'queue') {
      ({ rows, total } = await this.listQueueTab(tenantId, query, page, limit));
    } else if (query.tab === 'sent') {
      ({ rows, total } = await this.listSentTab(tenantId, query, page, limit));
    } else {
      const where: Prisma.SocialPostWhereInput = { tenantId };
      if (query.accountIds) where.targets = { some: { accountId: { in: query.accountIds.split(',').filter(Boolean) } } };
      if (query.tagIds) where.tags = { some: { id: { in: query.tagIds.split(',').filter(Boolean) } } };
      if (query.q) where.content = { contains: query.q, mode: 'insensitive' };
      if (query.from || query.to) {
        where.targets = {
          some: {
            ...(where.targets as Prisma.SocialPostTargetListRelationFilter)?.some,
            scheduledAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          },
        };
      }
      if (query.tab === 'drafts') where.status = 'draft';
      else if (query.tab === 'approvals') where.status = 'pending_approval';

      [rows, total] = await Promise.all([
        this.prisma.socialPost.findMany({ where, include: POST_INCLUDE, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        this.prisma.socialPost.count({ where }),
      ]);
    }

    const mediaMap = await resolveMediaMap(this.prisma, this.resolver, tenantId, rows.flatMap((r) => collectMediaIds(r)));
    return { data: rows.map((r) => toPostView(r, mediaMap)), total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * Same `accountIds`/`tagIds`/`q`/`from`/`to` filters as the plain-tab path
   * above, expressed as raw SQL fragments so `listQueueTab`/`listSentTab` can
   * `ORDER BY` an aggregate (MIN/MAX) over `social_post_targets` — something
   * Prisma's query builder can't express. `accountIds`+date-range share one
   * `EXISTS` (a single target must match both, mirroring the old `where.targets.some`).
   */
  private buildRawFilters(tenantId: string, query: PostListQueryDto): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`sp."tenantId" = ${tenantId}`];

    const accountIds = query.accountIds ? query.accountIds.split(',').filter(Boolean) : [];
    const hasRange = !!(query.from || query.to);
    if (accountIds.length > 0 || hasRange) {
      const targetConds: Prisma.Sql[] = [Prisma.sql`spt."postId" = sp.id`];
      if (accountIds.length > 0) targetConds.push(Prisma.sql`spt."accountId" IN (${Prisma.join(accountIds)})`);
      if (query.from) targetConds.push(Prisma.sql`spt."scheduledAt" >= ${new Date(query.from)}`);
      if (query.to) targetConds.push(Prisma.sql`spt."scheduledAt" <= ${new Date(query.to)}`);
      conditions.push(Prisma.sql`EXISTS (SELECT 1 FROM social_post_targets spt WHERE ${Prisma.join(targetConds, ' AND ')})`);
    }

    const tagIds = query.tagIds ? query.tagIds.split(',').filter(Boolean) : [];
    if (tagIds.length > 0) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "_SocialPostToSocialTag" spst WHERE spst."A" = sp.id AND spst."B" IN (${Prisma.join(tagIds)}))`,
      );
    }

    if (query.q) conditions.push(Prisma.sql`sp.content ILIKE ${'%' + query.q + '%'}`);

    return Prisma.join(conditions, ' AND ');
  }

  /** Hydrates raw-ordered post ids through Prisma (so `POST_INCLUDE` stays in one place) while preserving the raw query's order. */
  private async hydrateOrdered(ids: string[]): Promise<PostWithRelations[]> {
    if (ids.length === 0) return [];
    const found = await this.prisma.socialPost.findMany({ where: { id: { in: ids } }, include: POST_INCLUDE });
    const byId = new Map(found.map((f) => [f.id, f]));
    return ids.map((id) => byId.get(id)).filter((r): r is PostWithRelations => !!r);
  }

  /** Failed first, then by each post's earliest target `scheduledAt` ascending (soonest first) — CONTRACT.md §3.3. */
  private async listQueueTab(tenantId: string, query: PostListQueryDto, page: number, limit: number): Promise<{ rows: PostWithRelations[]; total: number }> {
    const filters = this.buildRawFilters(tenantId, query);
    const statusFilter = Prisma.sql`sp.status IN (${Prisma.join([...QUEUE_TAB_STATUSES])})`;

    const idRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT sp.id
      FROM social_posts sp
      LEFT JOIN social_post_targets agg_t ON agg_t."postId" = sp.id
      WHERE ${filters} AND ${statusFilter}
      GROUP BY sp.id
      ORDER BY (sp.status = 'failed') DESC, MIN(agg_t."scheduledAt") ASC NULLS LAST
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM social_posts sp WHERE ${filters} AND ${statusFilter}
    `;

    return { rows: await this.hydrateOrdered(idRows.map((r) => r.id)), total: Number(totalRows[0]?.count ?? 0) };
  }

  /** Latest `publishedAt` across a post's targets, descending — CONTRACT.md §3.3. */
  private async listSentTab(tenantId: string, query: PostListQueryDto, page: number, limit: number): Promise<{ rows: PostWithRelations[]; total: number }> {
    const filters = this.buildRawFilters(tenantId, query);
    const statusFilter = Prisma.sql`sp.status IN (${Prisma.join([...SENT_TAB_STATUSES])})`;

    const idRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT sp.id
      FROM social_posts sp
      LEFT JOIN social_post_targets agg_t ON agg_t."postId" = sp.id
      WHERE ${filters} AND ${statusFilter}
      GROUP BY sp.id
      ORDER BY MAX(agg_t."publishedAt") DESC NULLS LAST
      LIMIT ${limit} OFFSET ${(page - 1) * limit}
    `;
    const totalRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM social_posts sp WHERE ${filters} AND ${statusFilter}
    `;

    return { rows: await this.hydrateOrdered(idRows.map((r) => r.id)), total: Number(totalRows[0]?.count ?? 0) };
  }

  async getOne(tenantId: string, id: string): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    return this.buildView(post);
  }

  // ─── create / update / delete ───────────────────────────────────────────

  async create(tenantId: string, user: AuthenticatedUser, dto: CreatePostDto): Promise<SocialPostView> {
    if (dto.mode === 'custom' && !dto.scheduledAt) {
      throwIfInvalid([{ accountId: null, field: 'scheduledAt', code: 'SCHEDULED_AT_REQUIRED', message: 'El modo personalizado requiere una fecha.' }]);
    }
    if (dto.targets.length === 0) {
      throwIfInvalid([{ accountId: null, field: 'targets', code: 'TARGETS_REQUIRED', message: 'Selecciona al menos un canal.' }]);
    }

    const [settings, isAdmin, tenantUserId, accounts] = await Promise.all([
      this.access.getSettings(tenantId),
      this.access.isAdmin(user, tenantId),
      this.resolveTenantUserId(user.id, tenantId),
      this.prisma.socialAccount.findMany({ where: { tenantId, id: { in: dto.targets.map((t) => t.accountId) } } }),
    ]);

    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    for (const t of dto.targets) {
      if (!accountsById.has(t.accountId)) throw new NotFoundException(`Cuenta ${t.accountId} no encontrada`);
    }

    if (dto.ideaId) {
      const idea = await this.prisma.socialIdea.findFirst({ where: { id: dto.ideaId, tenantId }, select: { id: true } });
      if (!idea) throw new NotFoundException('Idea no encontrada');
    }

    let tagConnect: { id: string }[] = [];
    if (dto.tagIds?.length) {
      const tags = await this.prisma.socialTag.findMany({ where: { tenantId, id: { in: dto.tagIds } }, select: { id: true } });
      if (tags.length !== dto.tagIds.length) throw new NotFoundException('Alguna etiqueta no existe');
      tagConnect = tags.map((t) => ({ id: t.id }));
    }

    const baseMediaIds = dto.mediaIds ?? [];
    const mediaKindById = await this.resolveMediaKinds(tenantId, baseMediaIds, dto.targets.map((t) => t.mediaIds ?? undefined));

    const errors: FieldError[] = [];
    for (const t of dto.targets) {
      const account = accountsById.get(t.accountId)!;
      const effectiveMediaIds = t.mediaIds ?? baseMediaIds;
      errors.push(
        ...validateTarget({
          accountId: t.accountId,
          platform: account.platform === 'whatsapp' ? null : (account.platform as PublishablePlatform),
          accountStatus: account.status,
          content: t.content ?? dto.content,
          mediaKinds: effectiveMediaIds.map((id) => mediaKindById.get(id)).filter((k): k is MediaKind => !!k),
          options: (t.options as PlatformOptionsView) ?? {},
          thread: t.thread ?? [],
          firstComment: t.firstComment,
        }),
      );
    }
    throwIfInvalid(errors);

    const approvalNeeded = settings.approvalRequired && !isAdmin;
    const now = new Date();
    const initialStatus = approvalNeeded ? 'pending_approval' : dto.mode === 'draft' ? 'draft' : 'scheduled';

    const { postId, immediatePublishTargetIds } = await this.prisma.$transaction(async (tx) => {
      const post = await tx.socialPost.create({
        data: {
          tenantId,
          content: dto.content,
          mediaIds: baseMediaIds,
          scheduleMode: dto.mode,
          aiGenerated: dto.aiGenerated ?? false,
          ideaId: dto.ideaId ?? null,
          createdById: tenantUserId,
          status: initialStatus,
          ...(tagConnect.length ? { tags: { connect: tagConnect } } : {}),
        },
      });

      const immediateIds: string[] = [];
      for (const t of dto.targets) {
        const assignment = await this.planTargetSchedule(tx, tenantId, t.accountId, dto.mode, dto.scheduledAt, settings.defaultTimezone, now, approvalNeeded);
        const target = await tx.socialPostTarget.create({
          data: {
            tenantId,
            postId: post.id,
            accountId: t.accountId,
            status: initialStatus,
            content: t.content ?? null,
            ...(t.mediaIds !== undefined ? { mediaOverride: t.mediaIds as unknown as Prisma.InputJsonValue } : {}),
            options: (t.options as Prisma.InputJsonValue) ?? {},
            thread: (t.thread as unknown as Prisma.InputJsonValue) ?? [],
            firstComment: t.firstComment ?? null,
            scheduledAt: assignment.scheduledAt,
            slotted: assignment.slotted,
          },
        });
        if (!approvalNeeded && dto.mode === 'now') immediateIds.push(target.id);
      }

      return { postId: post.id, immediatePublishTargetIds: immediateIds };
    });

    if (immediatePublishTargetIds.length > 0) {
      await this.rabbitMQ.publish(SOCIAL_PUBLISH_QUEUE, { targetIds: immediatePublishTargetIds });
    }
    if (approvalNeeded) {
      await this.notifier.notify(tenantId, 'SOCIAL_APPROVAL_REQUESTED', {
        title: 'Publicación pendiente de aprobación',
        message: `"${dto.content.slice(0, 80)}" espera aprobación.`,
        actionUrl: `/dashboard/social-media/publish/${postId}`,
        entityId: postId,
      });
    }

    const post = await this.ensurePost(postId, tenantId);
    await this.realtime.emit(tenantId, 'social:post', { postId, status: post.status });
    return this.buildView(post);
  }

  async update(tenantId: string, user: AuthenticatedUser, id: string, dto: UpdatePostDto): Promise<SocialPostView> {
    const existing = await this.ensurePost(id, tenantId);
    if (existing.targets.some((t) => t.status === 'publishing' || t.status === 'published')) {
      throw new ConflictException('No se puede editar una publicación que ya se está publicando o ya se publicó');
    }

    // Full replace: caller sent a new target list — re-run the same create-time pipeline for scheduling/validation.
    if (dto.targets) {
      const createDto: CreatePostDto = {
        content: dto.content ?? existing.content,
        mediaIds: dto.mediaIds ?? existing.mediaIds,
        tagIds: dto.tagIds ?? existing.tags.map((t) => t.id),
        ideaId: dto.ideaId ?? existing.ideaId ?? undefined,
        aiGenerated: dto.aiGenerated ?? existing.aiGenerated,
        mode: dto.mode ?? (existing.scheduleMode as ScheduleMode),
        scheduledAt: dto.scheduledAt,
        targets: dto.targets,
      };
      // Deletes + recreates this post's targets IN PLACE (same post id) — see replaceTargets().
      return this.replaceTargets(tenantId, user, id, existing, createDto);
    }

    // Scalar-only patch: content/media/tags/idea/aiGenerated, no reschedule. Re-validate existing targets if content/media changed.
    const nextContent = dto.content ?? existing.content;
    const nextMediaIds = dto.mediaIds ?? existing.mediaIds;

    if (dto.content !== undefined || dto.mediaIds !== undefined) {
      const mediaKindById = await this.resolveMediaKinds(tenantId, nextMediaIds, existing.targets.map((t) => (t.mediaOverride as unknown as string[] | null) ?? undefined));
      const errors: FieldError[] = [];
      for (const t of existing.targets) {
        const override = t.mediaOverride as unknown as string[] | null;
        const effectiveMediaIds = override ?? nextMediaIds;
        errors.push(
          ...validateTarget({
            accountId: t.accountId,
            platform: t.account.platform === 'whatsapp' ? null : (t.account.platform as PublishablePlatform),
            accountStatus: t.account.status,
            content: t.content ?? nextContent,
            mediaKinds: effectiveMediaIds.map((mid) => mediaKindById.get(mid)).filter((k): k is MediaKind => !!k),
            options: (t.options as PlatformOptionsView) ?? {},
            thread: (t.thread as unknown as { content: string; mediaIds: string[] }[]) ?? [],
            firstComment: t.firstComment,
          }),
        );
      }
      throwIfInvalid(errors);
    }

    let tagUpdate: Prisma.SocialPostUpdateInput['tags'];
    if (dto.tagIds) {
      const tags = await this.prisma.socialTag.findMany({ where: { tenantId, id: { in: dto.tagIds } }, select: { id: true } });
      if (tags.length !== dto.tagIds.length) throw new NotFoundException('Alguna etiqueta no existe');
      tagUpdate = { set: tags.map((t) => ({ id: t.id })) };
    }

    await this.prisma.socialPost.update({
      where: { id },
      data: {
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.mediaIds !== undefined ? { mediaIds: dto.mediaIds } : {}),
        ...(dto.ideaId !== undefined ? { ideaId: dto.ideaId } : {}),
        ...(dto.aiGenerated !== undefined ? { aiGenerated: dto.aiGenerated } : {}),
        ...(tagUpdate ? { tags: tagUpdate } : {}),
      },
    });

    const post = await this.ensurePost(id, tenantId);
    await this.realtime.emit(tenantId, 'social:post', { postId: id, status: post.status });
    return this.buildView(post);
  }

  /** Shared by `update()`'s full-replace path. Deletes and recreates this post's targets IN PLACE (same post id). */
  private async replaceTargets(tenantId: string, user: AuthenticatedUser, postId: string, existing: PostWithRelations, dto: CreatePostDto): Promise<SocialPostView> {
    if (dto.mode === 'custom' && !dto.scheduledAt) {
      throwIfInvalid([{ accountId: null, field: 'scheduledAt', code: 'SCHEDULED_AT_REQUIRED', message: 'El modo personalizado requiere una fecha.' }]);
    }
    if (dto.targets.length === 0) {
      throwIfInvalid([{ accountId: null, field: 'targets', code: 'TARGETS_REQUIRED', message: 'Selecciona al menos un canal.' }]);
    }

    const [settings, isAdmin, accounts] = await Promise.all([
      this.access.getSettings(tenantId),
      this.access.isAdmin(user, tenantId),
      this.prisma.socialAccount.findMany({ where: { tenantId, id: { in: dto.targets.map((t) => t.accountId) } } }),
    ]);
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    for (const t of dto.targets) {
      if (!accountsById.has(t.accountId)) throw new NotFoundException(`Cuenta ${t.accountId} no encontrada`);
    }

    let tagConnect: { id: string }[] = [];
    if (dto.tagIds?.length) {
      const tags = await this.prisma.socialTag.findMany({ where: { tenantId, id: { in: dto.tagIds } }, select: { id: true } });
      if (tags.length !== dto.tagIds.length) throw new NotFoundException('Alguna etiqueta no existe');
      tagConnect = tags.map((t) => ({ id: t.id }));
    }

    const baseMediaIds = dto.mediaIds ?? [];
    const mediaKindById = await this.resolveMediaKinds(tenantId, baseMediaIds, dto.targets.map((t) => t.mediaIds ?? undefined));

    const errors: FieldError[] = [];
    for (const t of dto.targets) {
      const account = accountsById.get(t.accountId)!;
      const effectiveMediaIds = t.mediaIds ?? baseMediaIds;
      errors.push(
        ...validateTarget({
          accountId: t.accountId,
          platform: account.platform === 'whatsapp' ? null : (account.platform as PublishablePlatform),
          accountStatus: account.status,
          content: t.content ?? dto.content,
          mediaKinds: effectiveMediaIds.map((mid) => mediaKindById.get(mid)).filter((k): k is MediaKind => !!k),
          options: (t.options as PlatformOptionsView) ?? {},
          thread: t.thread ?? [],
          firstComment: t.firstComment,
        }),
      );
    }
    throwIfInvalid(errors);

    const approvalNeeded = settings.approvalRequired && !isAdmin;
    const now = new Date();
    const initialStatus = approvalNeeded ? 'pending_approval' : dto.mode === 'draft' ? 'draft' : 'scheduled';

    const immediatePublishTargetIds = await this.prisma.$transaction(async (tx) => {
      await tx.socialPostTarget.deleteMany({ where: { postId } });
      await tx.socialPost.update({
        where: { id: postId },
        data: {
          content: dto.content,
          mediaIds: baseMediaIds,
          scheduleMode: dto.mode,
          aiGenerated: dto.aiGenerated ?? existing.aiGenerated,
          ideaId: dto.ideaId ?? null,
          status: initialStatus,
          tags: { set: tagConnect },
        },
      });

      const immediateIds: string[] = [];
      for (const t of dto.targets) {
        const assignment = await this.planTargetSchedule(tx, tenantId, t.accountId, dto.mode, dto.scheduledAt, settings.defaultTimezone, now, approvalNeeded);
        const target = await tx.socialPostTarget.create({
          data: {
            tenantId,
            postId,
            accountId: t.accountId,
            status: initialStatus,
            content: t.content ?? null,
            ...(t.mediaIds !== undefined ? { mediaOverride: t.mediaIds as unknown as Prisma.InputJsonValue } : {}),
            options: (t.options as Prisma.InputJsonValue) ?? {},
            thread: (t.thread as unknown as Prisma.InputJsonValue) ?? [],
            firstComment: t.firstComment ?? null,
            scheduledAt: assignment.scheduledAt,
            slotted: assignment.slotted,
          },
        });
        if (!approvalNeeded && dto.mode === 'now') immediateIds.push(target.id);
      }
      return immediateIds;
    });

    if (immediatePublishTargetIds.length > 0) {
      await this.rabbitMQ.publish(SOCIAL_PUBLISH_QUEUE, { targetIds: immediatePublishTargetIds });
    }

    const post = await this.ensurePost(postId, tenantId);
    await this.realtime.emit(tenantId, 'social:post', { postId, status: post.status });
    return this.buildView(post);
  }

  async remove(tenantId: string, id: string): Promise<{ message: string }> {
    await this.ensurePost(id, tenantId);
    await this.prisma.socialPost.delete({ where: { id } });
    await this.realtime.emit(tenantId, 'social:post', { postId: id, deleted: true });
    return { message: 'Publicación eliminada' };
  }

  async duplicate(tenantId: string, user: AuthenticatedUser, id: string): Promise<SocialPostView> {
    const source = await this.ensurePost(id, tenantId);
    const tenantUserId = await this.resolveTenantUserId(user.id, tenantId);

    const created = await this.prisma.$transaction(async (tx) => {
      const post = await tx.socialPost.create({
        data: {
          tenantId,
          content: source.content,
          mediaIds: source.mediaIds,
          scheduleMode: 'draft',
          aiGenerated: source.aiGenerated,
          ideaId: source.ideaId,
          createdById: tenantUserId,
          status: 'draft',
          tags: { connect: source.tags.map((t) => ({ id: t.id })) },
        },
      });
      for (const t of source.targets) {
        await tx.socialPostTarget.create({
          data: {
            tenantId,
            postId: post.id,
            accountId: t.accountId,
            status: 'draft',
            content: t.content,
            mediaOverride: t.mediaOverride ?? Prisma.JsonNull,
            options: t.options ?? {},
            thread: t.thread ?? [],
            firstComment: t.firstComment,
            scheduledAt: null,
            slotted: false,
          },
        });
      }
      return post.id;
    });

    const post = await this.ensurePost(created, tenantId);
    return this.buildView(post);
  }

  // ─── scheduling actions ─────────────────────────────────────────────────

  async publishNow(tenantId: string, id: string): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    const eligible = post.targets.filter((t) => !TERMINAL_TARGET_STATUSES.has(t.status));
    if (eligible.length === 0) throw new ConflictException('No hay canales pendientes para publicar');

    const now = new Date();
    await this.prisma.$transaction(
      eligible.map((t) => this.prisma.socialPostTarget.update({ where: { id: t.id }, data: { status: 'scheduled', scheduledAt: now, slotted: false, error: null } })),
    );
    await this.rabbitMQ.publish(SOCIAL_PUBLISH_QUEUE, { targetIds: eligible.map((t) => t.id) });

    return this.settleAndReturn(tenantId, id);
  }

  async reschedule(tenantId: string, id: string, dto: RescheduleDto): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    const scheduledAt = new Date(dto.scheduledAt);

    const targets = dto.targetId ? post.targets.filter((t) => t.id === dto.targetId) : post.targets.filter((t) => !TERMINAL_TARGET_STATUSES.has(t.status));
    if (dto.targetId && targets.length === 0) throw new NotFoundException('Canal no encontrado en esta publicación');
    if (targets.some((t) => TERMINAL_TARGET_STATUSES.has(t.status))) throw new ConflictException('Ese canal ya se está publicando o ya se publicó');
    if (targets.length === 0) throw new ConflictException('No hay canales pendientes para reprogramar');

    await this.prisma.$transaction(targets.map((t) => this.prisma.socialPostTarget.update({ where: { id: t.id }, data: { status: 'scheduled', scheduledAt, slotted: false } })));
    return this.settleAndReturn(tenantId, id);
  }

  async requestApproval(tenantId: string, user: AuthenticatedUser, id: string): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    if (post.status !== 'draft') throw new ConflictException('Solo un borrador puede pedir aprobación');

    const settings = await this.access.getSettings(tenantId);
    const now = new Date();
    const mode = post.scheduleMode as ScheduleMode;

    await this.prisma.$transaction(async (tx) => {
      await tx.socialPost.update({ where: { id }, data: { status: 'pending_approval' } });
      for (const t of post.targets) {
        const assignment = await this.planTargetSchedule(tx, tenantId, t.accountId, mode, t.scheduledAt?.toISOString(), settings.defaultTimezone, now, true);
        await tx.socialPostTarget.update({ where: { id: t.id }, data: { status: 'pending_approval', scheduledAt: assignment.scheduledAt, slotted: assignment.slotted } });
      }
    });

    await this.notifier.notify(tenantId, 'SOCIAL_APPROVAL_REQUESTED', {
      title: 'Publicación pendiente de aprobación',
      message: `"${post.content.slice(0, 80)}" espera aprobación.`,
      actionUrl: `/dashboard/social-media/publish/${id}`,
      entityId: id,
    });

    return this.settleAndReturn(tenantId, id);
  }

  async approve(tenantId: string, user: AuthenticatedUser, id: string): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    if (post.status !== 'pending_approval') throw new ConflictException('Esta publicación no está pendiente de aprobación');

    const settings = await this.access.getSettings(tenantId);
    const tenantUserId = await this.resolveTenantUserId(user.id, tenantId);
    const now = new Date();
    const mode = post.scheduleMode as ScheduleMode;

    const immediateIds = await this.prisma.$transaction(async (tx) => {
      await tx.socialPost.update({ where: { id }, data: { status: 'scheduled', approvedById: tenantUserId, approvedAt: now, rejectionNote: null } });

      const immediate: string[] = [];
      for (const t of post.targets) {
        let scheduledAt: Date;
        let slotted = false;
        let publishNow = false;

        if (mode === 'queue') {
          scheduledAt = await this.scheduling.assignQueueSlot(tx, tenantId, t.accountId, settings.defaultTimezone, now);
          slotted = true;
        } else if (mode === 'next') {
          const plan = await this.scheduling.planNextSlot(tx, tenantId, t.accountId, settings.defaultTimezone, now);
          for (const shift of plan.shifts) await tx.socialPostTarget.update({ where: { id: shift.id }, data: { scheduledAt: shift.scheduledAt } });
          scheduledAt = plan.newSlot;
          slotted = true;
        } else if (mode === 'custom' && t.scheduledAt && t.scheduledAt.getTime() > now.getTime()) {
          scheduledAt = t.scheduledAt;
        } else {
          // now, or a custom time already in the past
          scheduledAt = now;
          publishNow = true;
        }

        await tx.socialPostTarget.update({ where: { id: t.id }, data: { status: 'scheduled', scheduledAt, slotted } });
        if (publishNow) immediate.push(t.id);
      }
      return immediate;
    });

    if (immediateIds.length > 0) await this.rabbitMQ.publish(SOCIAL_PUBLISH_QUEUE, { targetIds: immediateIds });

    await this.notifier.notify(tenantId, 'SOCIAL_POST_APPROVED', {
      title: 'Publicación aprobada',
      message: `"${post.content.slice(0, 80)}" fue aprobada.`,
      actionUrl: `/dashboard/social-media/publish/${id}`,
      entityId: id,
    });

    return this.settleAndReturn(tenantId, id);
  }

  async reject(tenantId: string, user: AuthenticatedUser, id: string, dto: RejectDto): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    if (post.status !== 'pending_approval') throw new ConflictException('Esta publicación no está pendiente de aprobación');

    await this.prisma.$transaction([
      this.prisma.socialPost.update({ where: { id }, data: { status: 'draft', rejectionNote: dto.note } }),
      this.prisma.socialPostTarget.updateMany({ where: { postId: id }, data: { status: 'draft' } }),
    ]);

    await this.notifier.notify(tenantId, 'SOCIAL_POST_REJECTED', {
      title: 'Publicación rechazada',
      message: `"${post.content.slice(0, 80)}" fue rechazada: ${dto.note}`,
      actionUrl: `/dashboard/social-media/publish/${id}`,
      entityId: id,
    });

    return this.settleAndReturn(tenantId, id);
  }

  async retryTarget(tenantId: string, id: string, targetId: string): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    const target = post.targets.find((t) => t.id === targetId);
    if (!target) throw new NotFoundException('Canal no encontrado en esta publicación');
    if (target.status !== 'failed') throw new ConflictException('Solo se puede reintentar un canal fallido');

    const now = new Date();
    await this.prisma.socialPostTarget.update({
      where: { id: targetId },
      data: { status: 'scheduled', scheduledAt: now, attempts: 0, error: null, nextAttemptAt: null, lockedAt: null },
    });
    await this.rabbitMQ.publish(SOCIAL_PUBLISH_QUEUE, { targetIds: [targetId] });

    return this.settleAndReturn(tenantId, id);
  }

  async markPublished(tenantId: string, id: string, targetId: string, dto: MarkPublishedDto): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    const target = post.targets.find((t) => t.id === targetId);
    if (!target) throw new NotFoundException('Canal no encontrado en esta publicación');
    if (target.status !== 'reminder_due') throw new ConflictException('Este canal no está esperando confirmación manual');

    await this.prisma.socialPostTarget.update({
      where: { id: targetId },
      data: { status: 'published', publishedAt: new Date(), externalUrl: dto.externalUrl ?? null },
    });

    return this.settleAndReturn(tenantId, id);
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async ensurePost(id: string, tenantId: string): Promise<PostWithRelations> {
    const post = await this.prisma.socialPost.findFirst({ where: { id, tenantId }, include: POST_INCLUDE });
    if (!post) throw new NotFoundException('Publicación no encontrada');
    return post;
  }

  private async buildView(post: PostWithRelations): Promise<SocialPostView> {
    const mediaMap = await resolveMediaMap(this.prisma, this.resolver, post.tenantId, collectMediaIds(post));
    return toPostView(post, mediaMap);
  }

  /** Recomputes `SocialPost.status` from its targets, emits `social:post`, and returns the fresh view. */
  private async settleAndReturn(tenantId: string, id: string): Promise<SocialPostView> {
    const post = await this.ensurePost(id, tenantId);
    const newStatus = recomputePostStatus(post.targets.map((t) => t.status as TargetStatus));
    if (newStatus !== post.status) {
      await this.prisma.socialPost.update({ where: { id }, data: { status: newStatus } });
    }
    await this.realtime.emit(tenantId, 'social:post', { postId: id, status: newStatus });
    return this.buildView(newStatus !== post.status ? await this.ensurePost(id, tenantId) : post);
  }

  private async resolveTenantUserId(userId: string, tenantId: string): Promise<string | null> {
    const tenantUser = await this.prisma.tenantUser.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
    return tenantUser?.id ?? null;
  }

  private async resolveMediaKinds(tenantId: string, baseMediaIds: string[], overrides: (string[] | undefined)[]): Promise<Map<string, MediaKind>> {
    const ids = new Set<string>(baseMediaIds);
    overrides.forEach((o) => o?.forEach((id) => ids.add(id)));
    if (ids.size === 0) return new Map();

    const rows = await this.prisma.socialMedia.findMany({ where: { tenantId, id: { in: Array.from(ids) } }, select: { id: true, kind: true } });
    const map = new Map(rows.map((r) => [r.id, r.kind as MediaKind]));
    for (const id of ids) {
      if (!map.has(id)) throw new NotFoundException(`Archivo ${id} no encontrado`);
    }
    return map;
  }

  /**
   * Computes one target's `{scheduledAt, slotted}` for `mode`, applying any
   * `mode=next` cascade shifts against `tx` so a multi-target create sees
   * its own writes. Deferred (null) for queue/next/now when approval gates
   * the post — CONTRACT.md §3.3 "approval computes the slots then".
   */
  private async planTargetSchedule(
    tx: Db,
    tenantId: string,
    accountId: string,
    mode: ScheduleMode,
    customScheduledAt: string | undefined,
    defaultTimezone: string,
    now: Date,
    approvalNeeded: boolean,
  ): Promise<{ scheduledAt: Date | null; slotted: boolean }> {
    if (mode === 'draft') return { scheduledAt: null, slotted: false };
    if (mode === 'custom') return { scheduledAt: customScheduledAt ? new Date(customScheduledAt) : null, slotted: false };
    if (approvalNeeded) return { scheduledAt: null, slotted: false };
    if (mode === 'now') return { scheduledAt: now, slotted: false };

    if (mode === 'queue') {
      const scheduledAt = await this.scheduling.assignQueueSlot(tx, tenantId, accountId, defaultTimezone, now);
      return { scheduledAt, slotted: true };
    }

    // mode === 'next'
    const { newSlot, shifts } = await this.scheduling.planNextSlot(tx, tenantId, accountId, defaultTimezone, now);
    for (const shift of shifts) {
      await tx.socialPostTarget.update({ where: { id: shift.id }, data: { scheduledAt: shift.scheduledAt } });
    }
    return { scheduledAt: newSlot, slotted: true };
  }
}
