import type { AccountType, SocialPlatform } from '../types';

/** OAuth (or app-password / session) tokens returned by a platform connect flow. */
export interface ConnectedAccountTokens {
  accessToken: string;
  refreshToken?: string | null;
  /** null = doesn't expire (or expiry unknown — treated as long-lived). */
  expiresAt?: Date | null;
}

/**
 * Normalized shape every platform connector returns. The social-accounts
 * service persists this as one `SocialAccount` row: `tokens` (+ `extraSecrets`)
 * go into `encryptedSecrets` via `encryptJson`, nothing else is stored in
 * plaintext.
 */
export interface ConnectedAccount {
  platform: SocialPlatform;
  accountType: AccountType;
  platformAccountId: string;
  name: string;
  username?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  tokens: ConnectedAccountTokens;
  /** Platform-specific extras merged alongside the tokens inside `encryptedSecrets` (e.g. Mastodon instance/client creds, WhatsApp waba/phone ids, Bluesky identifier for re-login). */
  extraSecrets?: Record<string, unknown>;
  scopes: string[];
  /** Facebook Pages only: subscribe this page to the app webhook right after connect. */
  subscribeWebhook?: boolean;
}

/** Decrypted shape of `SocialAccount.encryptedSecrets` (see {@link ConnectedAccount}). */
export interface SocialAccountSecrets {
  accessToken: string;
  refreshToken?: string | null;
  [key: string]: unknown;
}

/** Profile fields a platform's own "who am I" endpoint returns — used by `SocialAccountsService.refresh()` to re-sync name/handle/avatar without a full reconnect. */
export interface RefreshedProfile {
  name: string;
  username: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
}
