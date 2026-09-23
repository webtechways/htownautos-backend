import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import type { SocialAccount } from '@prisma/client';
import { decryptJson, encryptJson } from '../crypto/secret-box';
import { platformConfig } from '../config';
import { SocialApiError } from '../http/social-http';
import { SocialNotifierService } from '../notify/social-notifier';
import { SocialRealtimeService } from '../realtime/social-realtime.service';
import { toAccountView } from '../connect/account-view';
import type { SocialAccountSecrets } from '../connect/types';
import { refreshGoogleToken } from '../connect/platforms/google';
import { refreshLinkedInToken } from '../connect/platforms/linkedin';
import { refreshTikTokToken } from '../connect/platforms/tiktok';
import { refreshThreadsToken } from '../connect/platforms/threads';
import { refreshInstagramLoginToken } from '../connect/platforms/instagram-login';
import { refreshPinterestToken } from '../connect/platforms/pinterest';
import { refreshXToken } from '../connect/platforms/x';
import { connectBluesky, refreshBlueskySession } from '../connect/platforms/bluesky';
import type { SocialPlatform } from '../types';

/** Refresh a token proactively once it's this close to expiring (on-demand path, `getAccessToken`). */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Decrypts, refreshes and persists Social Suite account tokens. The single
 * place that knows how to talk to each platform's refresh endpoint — every
 * publisher/poller/inbox handler goes through `getAccessToken` instead of
 * reading `SocialAccount.encryptedSecrets` directly.
 */
@Injectable()
export class SocialTokenService {
  private readonly logger = new Logger(SocialTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: SocialNotifierService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  /** Decrypted extra secrets for an account (tokens + platform-specific fields). Never logged. */
  async getSecrets(account: SocialAccount): Promise<SocialAccountSecrets | null> {
    return decryptJson<SocialAccountSecrets>(account.encryptedSecrets);
  }

  /**
   * Returns a live access token, refreshing first when it expires in under
   * 5 minutes. Accepts either the row or an id (tenant-unchecked — internal
   * callers only, per "trust internal callers" §7; every external HTTP path
   * that reaches this already resolved the account through a tenant-scoped
   * query).
   */
  async getAccessToken(accountOrId: SocialAccount | string): Promise<string> {
    const account = typeof accountOrId === 'string' ? await this.loadAccount(accountOrId) : accountOrId;
    const secrets = await this.getSecrets(account);
    if (!secrets?.accessToken) {
      await this.markExpired(account, 'Sin credenciales guardadas');
      throw new SocialApiError({ platform: account.platform as SocialPlatform, httpStatus: 0, kind: 'AUTH', message: 'Cuenta sin credenciales — reconectar' });
    }

    const expiresAt = account.tokenExpiresAt;
    const needsRefresh = !!expiresAt && expiresAt.getTime() - Date.now() < REFRESH_THRESHOLD_MS;
    if (!needsRefresh) return secrets.accessToken;

    return this.refreshAndPersist(account, secrets);
  }

  /**
   * Hourly cron entry point (CONTRACT.md §4): refreshes every active,
   * api-published account whose token expires within `withinHours`.
   */
  async refreshExpiring(withinHours: number): Promise<{ refreshed: number; failed: number }> {
    const cutoff = new Date(Date.now() + withinHours * 60 * 60 * 1000);
    const accounts = await this.prisma.socialAccount.findMany({
      where: {
        status: 'active',
        publishMethod: 'api',
        isActive: true,
        tokenExpiresAt: { not: null, lt: cutoff },
      },
    });

    let refreshed = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const secrets = await this.getSecrets(account);
        if (!secrets?.accessToken) throw new Error('sin credenciales');
        await this.refreshAndPersist(account, secrets);
        refreshed++;
      } catch (err) {
        failed++;
        this.logger.warn(`refreshExpiring: account=${account.id} platform=${account.platform} — ${(err as Error).message}`);
      }
    }
    return { refreshed, failed };
  }

  private async loadAccount(id: string): Promise<SocialAccount> {
    const account = await this.prisma.socialAccount.findUniqueOrThrow({ where: { id } });
    return account;
  }

  private async refreshAndPersist(account: SocialAccount, secrets: SocialAccountSecrets): Promise<string> {
    try {
      const result = await this.callPlatformRefresh(account, secrets);
      if (!result) return secrets.accessToken; // platform doesn't expire / nothing to refresh

      const merged: SocialAccountSecrets = { ...secrets, accessToken: result.accessToken };
      if (result.refreshToken !== undefined) merged.refreshToken = result.refreshToken;

      await this.prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          encryptedSecrets: encryptJson(merged),
          tokenExpiresAt: result.expiresAt ?? account.tokenExpiresAt,
          status: 'active',
          lastSyncAt: new Date(),
          lastErrorAt: null,
          lastErrorMsg: null,
        },
      });
      return result.accessToken;
    } catch (err) {
      const message = err instanceof SocialApiError ? err.message : (err as Error).message;
      await this.markExpired(account, message);
      throw err instanceof SocialApiError
        ? err
        : new SocialApiError({ platform: account.platform as SocialPlatform, httpStatus: 0, kind: 'AUTH', message });
    }
  }

  /** Platform-specific refresh call. Returns `null` when the platform's token doesn't expire (nothing to do). */
  private async callPlatformRefresh(
    account: SocialAccount,
    secrets: SocialAccountSecrets,
  ): Promise<{ accessToken: string; refreshToken?: string | null; expiresAt?: Date | null } | null> {
    const platform = account.platform as SocialPlatform;

    switch (platform) {
      case 'youtube':
      case 'gbp': {
        if (!secrets.refreshToken) return null;
        const { clientId, clientSecret } = platformConfig(platform);
        const r = await refreshGoogleToken(clientId, clientSecret, secrets.refreshToken);
        return { accessToken: r.accessToken, expiresAt: r.expiresAt };
      }
      case 'linkedin': {
        if (!secrets.refreshToken) return null;
        const { clientId, clientSecret } = platformConfig('linkedin');
        const r = await refreshLinkedInToken(clientId, clientSecret, secrets.refreshToken);
        return { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt };
      }
      case 'tiktok': {
        if (!secrets.refreshToken) return null;
        const { clientId, clientSecret } = platformConfig('tiktok');
        const r = await refreshTikTokToken(clientId, clientSecret, secrets.refreshToken);
        return { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt };
      }
      case 'threads': {
        const r = await refreshThreadsToken(secrets.accessToken);
        return { accessToken: r.accessToken, expiresAt: r.expiresAt };
      }
      case 'instagram': {
        // Instagram-via-Facebook-Login uses a page token (never expires, `tokenExpiresAt` null — never reaches here).
        // Instagram Login has its own 60-day refresh.
        if (!account.tokenExpiresAt) return null;
        const r = await refreshInstagramLoginToken(secrets.accessToken);
        return { accessToken: r.accessToken, expiresAt: r.expiresAt };
      }
      case 'pinterest': {
        if (!secrets.refreshToken) return null;
        const { clientId, clientSecret } = platformConfig('pinterest');
        const r = await refreshPinterestToken(clientId, clientSecret, secrets.refreshToken);
        return { accessToken: r.accessToken, expiresAt: r.expiresAt };
      }
      case 'x': {
        if (!secrets.refreshToken) return null;
        const { clientId, clientSecret } = platformConfig('x');
        const r = await refreshXToken(clientId, clientSecret, secrets.refreshToken);
        return { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt };
      }
      case 'bluesky': {
        try {
          if (!secrets.refreshToken) throw new Error('sin refreshJwt');
          const r = await refreshBlueskySession(secrets.refreshToken);
          return { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: null };
        } catch {
          const identifier = secrets.identifier as string | undefined;
          const appPassword = secrets.appPassword as string | undefined;
          if (!identifier || !appPassword) throw new Error('sesión de Bluesky vencida y sin app password guardada');
          const [fresh] = await connectBluesky(identifier, appPassword);
          return { accessToken: fresh.tokens.accessToken, refreshToken: fresh.tokens.refreshToken, expiresAt: null };
        }
      }
      case 'facebook':
      case 'mastodon':
      case 'whatsapp':
      default:
        // Page tokens (Facebook), Mastodon tokens and WhatsApp system-user tokens don't expire on their own.
        return null;
    }
  }

  private async markExpired(account: SocialAccount, reason: string): Promise<void> {
    if (account.status === 'expired') return; // already flagged — don't re-notify every retry

    await this.prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: 'expired', lastErrorAt: new Date(), lastErrorMsg: reason },
    });

    await this.notifier.notify(account.tenantId, 'SOCIAL_ACCOUNT_DISCONNECTED', {
      title: 'Cuenta social desconectada',
      message: `${account.name} (${account.platform}) necesita reconectarse: ${reason}`,
      actionUrl: '/dashboard/settings/integrations',
      entityId: account.id,
    });

    const updated = await this.prisma.socialAccount.findUnique({ where: { id: account.id } });
    if (updated) {
      await this.realtime.emit(account.tenantId, 'social:account', { account: toAccountView(updated) });
    }
  }
}
