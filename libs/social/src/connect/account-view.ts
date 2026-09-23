import type { SocialAccount as PrismaSocialAccount, SocialPostingSchedule } from '@prisma/client';
import { capabilitiesFor } from '../capabilities';
import type { AccountCapabilities, AccountStatus, AccountType, PublishMethod, SocialPlatform } from '../types';

const DEFAULT_TIMEZONE = 'America/Chicago';

/** Mirrors `SocialAccount` in docs/social-suite/contract.ts — the one place that builds it from the Prisma row. */
export interface SocialAccountView {
  id: string;
  platform: SocialPlatform;
  accountType: AccountType | null;
  publishMethod: PublishMethod;
  status: AccountStatus;
  platformAccountId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  capabilities: AccountCapabilities;
  timezone: string;
  queuePaused: boolean;
  needsReconnect: boolean;
  isActive: boolean;
  scopes: string[];
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
  lastErrorMsg: string | null;
  createdAt: string;
}

/**
 * Builds the contract `SocialAccount` shape from the Prisma row + its (optional)
 * posting schedule. Used by both the api's social-accounts endpoints and
 * `SocialTokenService` (which emits `social:account` realtime pings without
 * a schedule join — schedule falls back to the tenant defaults).
 */
export function toAccountView(
  account: PrismaSocialAccount,
  schedule?: Pick<SocialPostingSchedule, 'timezone' | 'paused'> | null,
): SocialAccountView {
  const status = account.status as AccountStatus;
  const platform = account.platform as SocialPlatform;
  const accountType = (account.accountType as AccountType | null) ?? null;
  const publishMethod = account.publishMethod as PublishMethod;

  return {
    id: account.id,
    platform,
    accountType,
    publishMethod,
    status,
    platformAccountId: account.platformAccountId,
    name: account.name,
    username: account.username,
    avatarUrl: account.avatarUrl,
    profileUrl: account.profileUrl,
    capabilities: capabilitiesFor(platform, accountType, publishMethod),
    timezone: schedule?.timezone ?? DEFAULT_TIMEZONE,
    queuePaused: schedule?.paused ?? false,
    needsReconnect: status === 'expired' || status === 'error',
    isActive: account.isActive,
    scopes: account.scopes,
    tokenExpiresAt: account.tokenExpiresAt ? account.tokenExpiresAt.toISOString() : null,
    lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
    lastErrorMsg: account.lastErrorMsg,
    createdAt: account.createdAt.toISOString(),
  };
}
