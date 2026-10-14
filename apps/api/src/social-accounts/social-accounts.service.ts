import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { RedisService } from '@htownautos/redis';
import type { SocialAccount as PrismaSocialAccount, SocialPostingSchedule } from '@prisma/client';
import {
  platformConfig,
  capabilitiesFor,
  encryptJson,
  signOAuthState,
  verifyOAuthState,
  peekStateNonce,
  toAccountView,
  SocialApiError,
  SocialTokenService,
  type SocialAccountView,
  type SocialAccountSecrets,
  type ConnectedAccount,
  type SocialPlatform,
  type AccountType,
  buildFacebookOAuthUrl,
  connectFacebookPages,
  connectInstagramViaFacebook,
  subscribeFacebookPageWebhook,
  FACEBOOK_SCOPES,
  INSTAGRAM_FB_LOGIN_SCOPES,
  buildInstagramLoginOAuthUrl,
  connectInstagramLogin as connectInstagramLoginApi,
  buildTikTokOAuthUrl,
  connectTikTok as connectTikTokApi,
  buildGoogleOAuthUrl,
  connectYouTube as connectYouTubeApi,
  connectGbp as connectGbpApi,
  YOUTUBE_SCOPES,
  GBP_SCOPES,
  buildLinkedInOAuthUrl,
  connectLinkedIn as connectLinkedInApi,
  buildPinterestOAuthUrl,
  connectPinterest as connectPinterestApi,
  listPinterestBoards,
  buildThreadsOAuthUrl,
  connectThreads as connectThreadsApi,
  connectBluesky as connectBlueskyApi,
  generatePkcePair,
  buildXOAuthUrl,
  connectX as connectXApi,
  registerMastodonApp,
  buildMastodonOAuthUrl,
  connectMastodon as connectMastodonApi,
  connectWhatsAppEmbedded as connectWhatsAppEmbeddedApi,
  connectWhatsAppManual as connectWhatsAppManualApi,
  fetchFacebookPageProfile,
  fetchInstagramViaFacebookProfile,
  fetchInstagramLoginProfile,
  fetchThreadsProfile,
  fetchLinkedInProfile,
  fetchPinterestProfile,
  fetchTikTokProfile,
  fetchXProfile,
  fetchMastodonProfile,
  fetchWhatsAppProfile,
  type RefreshedProfile,
} from '@htownautos/social';
import {
  ConnectSocialAccountDto,
  ConnectBlueskyDto,
  MastodonStartDto,
  WhatsAppEmbeddedSignupDto,
  WhatsAppManualConnectDto,
  ReminderChannelDto,
  UpdateSocialAccountDto,
  CreateSocialGroupDto,
  UpdateSocialGroupDto,
} from './dto';

const DEFAULT_TIMEZONE = 'America/Chicago';
const REDIS_FLOW_TTL_SEC = 10 * 60; // 10 minutes — matches the OAuth state TTL

type ScheduleSlice = Pick<SocialPostingSchedule, 'timezone' | 'paused'>;

@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger(SocialAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokenService: SocialTokenService,
  ) {}

  // ─── OAuth URL ───────────────────────────────────────────────────────────

  async getOAuthUrl(
    tenantId: string,
    userId: string,
    platform: SocialPlatform,
    redirectUri: string,
    accountType?: AccountType,
  ): Promise<{ url: string }> {
    const state = signOAuthState({ platform, tenantId, userId, accountType });

    switch (platform) {
      case 'facebook': {
        const { clientId } = this.cfg('facebook');
        return { url: buildFacebookOAuthUrl(clientId, redirectUri, state, FACEBOOK_SCOPES) };
      }
      case 'instagram': {
        const { clientId } = this.cfg('instagram');
        return this.hasOwnInstagramApp()
          ? { url: buildInstagramLoginOAuthUrl(clientId, redirectUri, state) }
          : { url: buildFacebookOAuthUrl(clientId, redirectUri, state, INSTAGRAM_FB_LOGIN_SCOPES) };
      }
      case 'threads': {
        const { clientId } = this.cfg('threads');
        return { url: buildThreadsOAuthUrl(clientId, redirectUri, state) };
      }
      case 'tiktok': {
        const { clientId } = this.cfg('tiktok');
        return { url: buildTikTokOAuthUrl(clientId, redirectUri, state) };
      }
      case 'youtube': {
        const { clientId } = this.cfg('youtube');
        return { url: buildGoogleOAuthUrl(clientId, redirectUri, state, YOUTUBE_SCOPES) };
      }
      case 'gbp': {
        const { clientId } = this.cfg('gbp');
        return { url: buildGoogleOAuthUrl(clientId, redirectUri, state, GBP_SCOPES) };
      }
      case 'linkedin': {
        const { clientId } = this.cfg('linkedin');
        return { url: buildLinkedInOAuthUrl(clientId, redirectUri, state) };
      }
      case 'pinterest': {
        const { clientId } = this.cfg('pinterest');
        return { url: buildPinterestOAuthUrl(clientId, redirectUri, state) };
      }
      case 'x': {
        const { clientId } = this.cfg('x');
        const { codeVerifier, codeChallenge } = generatePkcePair();
        await this.stashFlowData(`social:x:verifier:${peekStateNonce(state)}`, codeVerifier);
        return { url: buildXOAuthUrl(clientId, redirectUri, state, codeChallenge) };
      }
      case 'bluesky':
        throw new BadRequestException('Bluesky se conecta con POST /social-accounts/connect/bluesky (app password)');
      case 'mastodon':
        throw new BadRequestException('Mastodon se conecta con POST /social-accounts/connect/mastodon/start');
      case 'whatsapp':
        throw new BadRequestException('WhatsApp se conecta con POST /social-accounts/connect/whatsapp');
      default:
        throw new BadRequestException(`OAuth no soportado para: ${platform}`);
    }
  }

  async mastodonStart(tenantId: string, userId: string, dto: MastodonStartDto): Promise<{ url: string }> {
    const { clientId, clientSecret } = await registerMastodonApp(dto.instance, dto.redirectUri);
    const state = signOAuthState({ platform: 'mastodon', tenantId, userId, instance: dto.instance });
    await this.stashFlowData(
      `social:mastodon:app:${peekStateNonce(state)}`,
      JSON.stringify({ clientId, clientSecret, instance: dto.instance }),
    );
    return { url: buildMastodonOAuthUrl(dto.instance, clientId, dto.redirectUri, state) };
  }

  // ─── OAuth code exchange ────────────────────────────────────────────────

  async connect(tenantId: string, userId: string, dto: ConnectSocialAccountDto): Promise<SocialAccountView[]> {
    const statePayload = this.verifyState(dto.state, tenantId, userId);
    const platform = statePayload.platform;

    let connected: ConnectedAccount[];
    switch (platform) {
      case 'facebook': {
        const { clientId, clientSecret } = this.cfg('facebook');
        connected = await connectFacebookPages(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'instagram': {
        const { clientId, clientSecret } = this.cfg('instagram');
        connected = this.hasOwnInstagramApp()
          ? await connectInstagramLoginApi(clientId, clientSecret, dto.code, dto.redirectUri)
          : await connectInstagramViaFacebook(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'threads': {
        const { clientId, clientSecret } = this.cfg('threads');
        connected = await connectThreadsApi(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'tiktok': {
        const { clientId, clientSecret } = this.cfg('tiktok');
        connected = await connectTikTokApi(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'youtube': {
        const { clientId, clientSecret } = this.cfg('youtube');
        connected = await connectYouTubeApi(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'gbp': {
        const { clientId, clientSecret } = this.cfg('gbp');
        connected = await connectGbpApi(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'linkedin': {
        const { clientId, clientSecret } = this.cfg('linkedin');
        connected = await connectLinkedInApi(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'pinterest': {
        const { clientId, clientSecret } = this.cfg('pinterest');
        connected = await connectPinterestApi(clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      case 'x': {
        const { clientId, clientSecret } = this.cfg('x');
        const codeVerifier = await this.popFlowData(`social:x:verifier:${statePayload.nonce}`);
        if (!codeVerifier) throw new BadRequestException('El flujo de X expiró — vuelve a conectar');
        connected = await connectXApi(clientId, clientSecret, dto.code, dto.redirectUri, codeVerifier);
        break;
      }
      case 'mastodon': {
        const raw = await this.popFlowData(`social:mastodon:app:${statePayload.nonce}`);
        if (!raw) throw new BadRequestException('El flujo de Mastodon expiró — vuelve a conectar');
        const { clientId, clientSecret, instance } = JSON.parse(raw) as { clientId: string; clientSecret: string; instance: string };
        connected = await connectMastodonApi(instance, clientId, clientSecret, dto.code, dto.redirectUri);
        break;
      }
      default:
        throw new BadRequestException(`${platform} no soporta este flujo — usa el endpoint dedicado`);
    }

    return this.persistAll(tenantId, connected);
  }

  async connectBluesky(tenantId: string, dto: ConnectBlueskyDto): Promise<SocialAccountView[]> {
    const connected = await connectBlueskyApi(dto.identifier, dto.appPassword);
    return this.persistAll(tenantId, connected);
  }

  async connectWhatsAppEmbedded(tenantId: string, dto: WhatsAppEmbeddedSignupDto): Promise<SocialAccountView[]> {
    if (!dto.wabaId || !dto.phoneNumberId) {
      throw new BadRequestException('wabaId y phoneNumberId son requeridos (del evento de Embedded Signup)');
    }
    const { clientId, clientSecret } = this.cfg('whatsapp');
    const connected = await connectWhatsAppEmbeddedApi(clientId, clientSecret, dto.code, dto.wabaId, dto.phoneNumberId);
    return this.persistAll(tenantId, connected);
  }

  /** Admin-only — enforced by `RequireRoles` on the controller route. */
  async connectWhatsAppManual(tenantId: string, dto: WhatsAppManualConnectDto): Promise<SocialAccountView[]> {
    const connected = await connectWhatsAppManualApi(dto.wabaId, dto.phoneNumberId, dto.accessToken);
    return this.persistAll(tenantId, connected);
  }

  async connectReminder(tenantId: string, dto: ReminderChannelDto): Promise<SocialAccountView> {
    const row = await this.prisma.socialAccount.create({
      data: {
        tenantId,
        platform: dto.platform,
        platformAccountId: `reminder:${randomUUID()}`,
        name: dto.name,
        username: dto.username ?? null,
        profileUrl: dto.profileUrl ?? null,
        accountType: dto.accountType,
        publishMethod: 'reminder',
        status: 'active',
        isActive: true,
        scopes: [],
      },
    });
    return toAccountView(row, null);
  }

  // ─── CRUD ───────────────────────────────────────────────────────────────

  async findAll(tenantId: string): Promise<SocialAccountView[]> {
    const accounts = await this.prisma.socialAccount.findMany({
      where: { tenantId },
      orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    });
    if (!accounts.length) return [];

    const schedules = await this.prisma.socialPostingSchedule.findMany({
      where: { tenantId, accountId: { in: accounts.map((a) => a.id) } },
      select: { accountId: true, timezone: true, paused: true },
    });
    const byAccount = new Map(schedules.map((s) => [s.accountId, s]));
    return accounts.map((a) => toAccountView(a, byAccount.get(a.id)));
  }

  async findOne(tenantId: string, id: string): Promise<SocialAccountView> {
    const account = await this.ensureAccount(id, tenantId);
    const schedule = await this.getSchedule(id);
    return toAccountView(account, schedule);
  }

  async update(tenantId: string, id: string, dto: UpdateSocialAccountDto): Promise<SocialAccountView> {
    await this.ensureAccount(id, tenantId);

    if (dto.name !== undefined) {
      await this.prisma.socialAccount.update({ where: { id }, data: { name: dto.name } });
    }

    if (dto.timezone !== undefined || dto.queuePaused !== undefined) {
      await this.prisma.socialPostingSchedule.upsert({
        where: { accountId: id },
        update: {
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.queuePaused !== undefined ? { paused: dto.queuePaused } : {}),
        },
        create: {
          tenantId,
          accountId: id,
          timezone: dto.timezone ?? DEFAULT_TIMEZONE,
          paused: dto.queuePaused ?? false,
        },
      });
    }

    const account = await this.ensureAccount(id, tenantId);
    const schedule = await this.getSchedule(id);
    return toAccountView(account, schedule);
  }

  /** Best-effort token refresh + per-platform profile re-fetch (name/username/avatarUrl/profileUrl), re-using each connector's own "who am I" call (see {@link refreshProfile}). */
  async refresh(tenantId: string, id: string): Promise<SocialAccountView> {
    const account = await this.ensureAccount(id, tenantId);
    if (account.publishMethod === 'api') {
      try {
        await this.tokenService.getAccessToken(account);
      } catch (err) {
        this.logger.warn(`refresh: account=${id} — ${(err as Error).message}`);
      }
    }

    const afterTokenRefresh = await this.ensureAccount(id, tenantId);
    await this.refreshProfile(afterTokenRefresh);

    const updated = await this.ensureAccount(id, tenantId);
    const schedule = await this.getSchedule(id);
    return toAccountView(updated, schedule);
  }

  /**
   * Re-fetches name/username/avatarUrl/profileUrl straight from the platform,
   * with the exact fields/endpoint each connector already used at connect
   * time. Best-effort: a failed profile fetch never fails `refresh()` — the
   * token refresh above is the part that matters for the account staying
   * usable. Bluesky, YouTube and GBP have no single-account "who am I" GET
   * in the current connectors (Bluesky is session-based with no profile
   * endpoint wired here; YouTube/GBP connect by listing every channel/location,
   * not by id) — those three keep whatever name/avatar was stored at connect.
   */
  private async refreshProfile(account: PrismaSocialAccount): Promise<void> {
    try {
      const secrets = await this.tokenService.getSecrets(account);
      if (!secrets?.accessToken) return;

      let profile: RefreshedProfile | null = null;
      switch (account.platform as SocialPlatform) {
        case 'facebook':
          profile = await fetchFacebookPageProfile(account.platformAccountId, secrets.accessToken);
          break;
        case 'instagram':
          // Instagram-via-Facebook-Login accounts carry `fbPageId` in extraSecrets (see connectInstagramViaFacebook); native Instagram Login accounts don't.
          profile = secrets.fbPageId
            ? await fetchInstagramViaFacebookProfile(account.platformAccountId, secrets.accessToken)
            : await fetchInstagramLoginProfile(account.platformAccountId, secrets.accessToken);
          break;
        case 'threads':
          profile = await fetchThreadsProfile(account.platformAccountId, secrets.accessToken);
          break;
        case 'linkedin':
          // Organization pages have no single-org GET in this connector (only the member's organizationAcls listing) — only the member profile refreshes.
          if (account.accountType === 'profile') profile = await fetchLinkedInProfile(secrets.accessToken);
          break;
        case 'pinterest':
          profile = await fetchPinterestProfile(secrets.accessToken);
          break;
        case 'tiktok':
          profile = await fetchTikTokProfile(secrets.accessToken);
          break;
        case 'x':
          profile = await fetchXProfile(secrets.accessToken);
          break;
        case 'mastodon': {
          const instance = secrets.instance as string | undefined;
          if (instance) profile = await fetchMastodonProfile(instance, secrets.accessToken);
          break;
        }
        case 'whatsapp':
          profile = await fetchWhatsAppProfile(account.platformAccountId, secrets.accessToken);
          break;
        default:
          break;
      }

      if (profile) {
        await this.prisma.socialAccount.update({
          where: { id: account.id },
          data: { name: profile.name, username: profile.username, avatarUrl: profile.avatarUrl, profileUrl: profile.profileUrl },
        });
      }
    } catch (err) {
      this.logger.warn(`refreshProfile: account=${account.id} platform=${account.platform} — ${(err as Error).message}`);
    }
  }

  /** Soft disconnect: wipes credentials, deactivates, cancels the account's not-yet-published targets. */
  async disconnect(tenantId: string, id: string): Promise<{ message: string }> {
    await this.ensureAccount(id, tenantId);

    await this.prisma.$transaction([
      this.prisma.socialAccount.update({
        where: { id },
        data: {
          status: 'disconnected',
          isActive: false,
          encryptedSecrets: null,
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
        },
      }),
      this.prisma.socialPostTarget.updateMany({
        where: { accountId: id, tenantId, status: { in: ['scheduled', 'pending_approval'] } },
        data: { status: 'cancelled' },
      }),
    ]);

    return { message: 'Cuenta desconectada' };
  }

  async listBoards(tenantId: string, id: string): Promise<{ id: string; name: string }[]> {
    const account = await this.ensureAccount(id, tenantId);
    if (account.platform !== 'pinterest') {
      throw new BadRequestException('Solo las cuentas de Pinterest tienen boards');
    }
    const accessToken = await this.tokenService.getAccessToken(account);
    return listPinterestBoards(accessToken);
  }

  // ─── Groups (unchanged surface) ─────────────────────────────────────────

  private static readonly GROUP_ACCOUNT_SELECT = {
    account: { select: { id: true, platform: true, name: true, avatarUrl: true, username: true } },
  } satisfies Record<string, unknown>;

  async findAllGroups(tenantId: string) {
    return this.prisma.socialGroup.findMany({
      where: { tenantId },
      include: { accounts: { include: SocialAccountsService.GROUP_ACCOUNT_SELECT } },
      orderBy: { name: 'asc' },
    });
  }

  async createGroup(tenantId: string, dto: CreateSocialGroupDto) {
    const group = await this.prisma.socialGroup.create({ data: { tenantId, name: dto.name } });

    if (dto.accountIds?.length) {
      const owned = await this.prisma.socialAccount.findMany({
        where: { id: { in: dto.accountIds }, tenantId },
        select: { id: true },
      });
      await this.prisma.socialGroupAccount.createMany({
        data: owned.map((a) => ({ socialGroupId: group.id, socialAccountId: a.id })),
        skipDuplicates: true,
      });
    }

    return this.prisma.socialGroup.findUnique({
      where: { id: group.id },
      include: { accounts: { include: SocialAccountsService.GROUP_ACCOUNT_SELECT } },
    });
  }

  async updateGroup(tenantId: string, id: string, dto: UpdateSocialGroupDto) {
    const group = await this.prisma.socialGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Group not found');

    if (dto.name) {
      await this.prisma.socialGroup.update({ where: { id }, data: { name: dto.name } });
    }

    if (dto.accountIds !== undefined) {
      await this.prisma.socialGroupAccount.deleteMany({ where: { socialGroupId: id } });
      if (dto.accountIds.length > 0) {
        const owned = await this.prisma.socialAccount.findMany({
          where: { id: { in: dto.accountIds }, tenantId },
          select: { id: true },
        });
        await this.prisma.socialGroupAccount.createMany({
          data: owned.map((a) => ({ socialGroupId: id, socialAccountId: a.id })),
          skipDuplicates: true,
        });
      }
    }

    return this.prisma.socialGroup.findUnique({
      where: { id },
      include: { accounts: { include: SocialAccountsService.GROUP_ACCOUNT_SELECT } },
    });
  }

  async deleteGroup(tenantId: string, id: string) {
    const group = await this.prisma.socialGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Group not found');
    await this.prisma.socialGroup.delete({ where: { id } });
    return { message: 'Group deleted' };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  /** Every mutating method above resolves the row through this first, so a cross-tenant id is a 404, not a 403. */
  private async ensureAccount(id: string, tenantId: string): Promise<PrismaSocialAccount> {
    const account = await this.prisma.socialAccount.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Social account not found');
    return account;
  }

  private async getSchedule(accountId: string): Promise<ScheduleSlice | null> {
    return this.prisma.socialPostingSchedule.findUnique({
      where: { accountId },
      select: { timezone: true, paused: true },
    });
  }

  private cfg(platform: SocialPlatform): { clientId: string; clientSecret: string } {
    try {
      return platformConfig(platform);
    } catch (err) {
      if (err instanceof SocialApiError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private verifyState(state: string, tenantId: string, userId: string) {
    try {
      return verifyOAuthState(state, { tenantId, userId });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  /** `INSTAGRAM_APP_ID` set (distinct from the Facebook-app fallback) → Instagram Login; otherwise Instagram-via-Facebook-Login. */
  private hasOwnInstagramApp(): boolean {
    return !!process.env.INSTAGRAM_APP_ID && !!process.env.INSTAGRAM_APP_SECRET;
  }

  private async stashFlowData(key: string, value: string): Promise<void> {
    await this.redis.getClient().set(key, value, 'EX', REDIS_FLOW_TTL_SEC);
  }

  private async popFlowData(key: string): Promise<string | null> {
    const value = await this.redis.getClient().get(key);
    if (value) await this.redis.getClient().del(key);
    return value;
  }

  private async persistAll(tenantId: string, connected: ConnectedAccount[]): Promise<SocialAccountView[]> {
    const results: SocialAccountView[] = [];
    for (const acc of connected) {
      const row = await this.upsertAccount(tenantId, acc);

      if (acc.subscribeWebhook) {
        try {
          await subscribeFacebookPageWebhook(acc.platformAccountId, acc.tokens.accessToken);
          await this.prisma.socialAccount.update({ where: { id: row.id }, data: { webhookSubscribedAt: new Date() } });
        } catch (err) {
          this.logger.warn(`Facebook webhook subscribe failed for account=${row.id}: ${(err as Error).message}`);
        }
      }

      const schedule = await this.getSchedule(row.id);
      results.push(toAccountView(row, schedule));
    }
    return results;
  }

  private async upsertAccount(tenantId: string, acc: ConnectedAccount): Promise<PrismaSocialAccount> {
    const secrets: SocialAccountSecrets = {
      accessToken: acc.tokens.accessToken,
      refreshToken: acc.tokens.refreshToken ?? null,
      ...(acc.extraSecrets || {}),
    };

    const shared = {
      name: acc.name,
      username: acc.username ?? null,
      avatarUrl: acc.avatarUrl ?? null,
      profileUrl: acc.profileUrl ?? null,
      accountType: acc.accountType,
      publishMethod: 'api' as const,
      status: 'active' as const,
      scopes: acc.scopes,
      encryptedSecrets: encryptJson(secrets),
      tokenExpiresAt: acc.tokens.expiresAt ?? null,
      isActive: true,
      lastSyncAt: new Date(),
      lastErrorAt: null,
      lastErrorMsg: null,
      // Superseded by encryptedSecrets going forward — cleared so a reconnect never leaves stale plaintext behind.
      accessToken: null,
      refreshToken: null,
    };

    return this.prisma.socialAccount.upsert({
      where: {
        tenantId_platform_platformAccountId: {
          tenantId,
          platform: acc.platform,
          platformAccountId: acc.platformAccountId,
        },
      },
      update: shared,
      create: { tenantId, platform: acc.platform, platformAccountId: acc.platformAccountId, ...shared },
    });
  }
}
