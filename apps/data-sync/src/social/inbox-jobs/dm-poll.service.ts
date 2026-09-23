import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { SocialIngestService, SocialRealtimeService, SocialTokenService, socialFetch, type NormalizedInboxMessage } from '@htownautos/social';
import type { SocialAccount } from '@prisma/client';

/** How many of the most recent DM events to (re-)fetch each poll — idempotent upsert makes over-fetching safe; simpler than persisting a per-platform resume cursor (no dedicated column on SocialAccount for it). */
const RECENT_EVENTS_LIMIT = 20;
const CHAT_PROXY_HEADER = { 'atproto-proxy': 'did:web:api.bsky.chat#bsky_chat' };
const BLUESKY_XRPC = 'https://bsky.social/xrpc';

/**
 * DM pollers (CONTRACT.md §4, every 2 min): X, Bluesky, Mastodon — the three
 * social channels with no realtime webhook for DMs available to us (unlike
 * Messenger/Instagram/WhatsApp, which arrive via `MetaWebhookController`).
 */
@Injectable()
export class DmPollService {
  private readonly logger = new Logger(DmPollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SocialTokenService,
    private readonly ingest: SocialIngestService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  @Cron('*/2 * * * *')
  async tick(): Promise<void> {
    const accounts = await this.prisma.socialAccount.findMany({ where: { status: 'active', platform: { in: ['x', 'bluesky', 'mastodon'] } } });
    for (const account of accounts) {
      try {
        if (account.platform === 'x') await this.pollX(account);
        else if (account.platform === 'bluesky') await this.pollBluesky(account);
        else if (account.platform === 'mastodon') await this.pollMastodon(account);
      } catch (err) {
        await this.handlePollError(account, err as Error);
      }
    }
  }

  // ─── X ──────────────────────────────────────────────────────────────

  private async pollX(account: SocialAccount): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(account);
    const url = new URL('https://api.x.com/2/dm_events');
    url.searchParams.set('dm_event.fields', 'sender_id,dm_conversation_id,created_at,text');
    url.searchParams.set('event_types', 'MessageCreate');
    url.searchParams.set('max_results', String(RECENT_EVENTS_LIMIT));

    const res = await socialFetch(url.toString(), { platform: 'x', headers: { Authorization: `Bearer ${accessToken}` } });
    const data = (await res.json()) as { data?: Array<{ id: string; sender_id: string; dm_conversation_id: string; created_at: string; text?: string }> };

    for (const event of data.data ?? []) {
      if (event.sender_id === account.platformAccountId) continue; // our own outbound event — already recorded when we sent it
      await this.recordAndNotify({
        tenantId: account.tenantId,
        channel: 'x',
        provider: 'x',
        senderKind: 'social_account',
        senderKey: account.id,
        socialAccountId: account.id,
        contactExternalId: event.sender_id,
        direction: 'inbound',
        body: event.text ?? null,
        status: 'received',
        externalId: event.id,
        platformCreatedAt: new Date(event.created_at),
      });
    }

    await this.clearPollError(account);
  }

  // ─── Bluesky ────────────────────────────────────────────────────────

  private async pollBluesky(account: SocialAccount): Promise<void> {
    const accessToken = await this.tokens.getAccessToken(account);
    const listUrl = new URL(`${BLUESKY_XRPC}/chat.bsky.convo.listConvos`);
    listUrl.searchParams.set('limit', '50');
    const listRes = await socialFetch(listUrl.toString(), { platform: 'bluesky', headers: { Authorization: `Bearer ${accessToken}`, ...CHAT_PROXY_HEADER } });
    const list = (await listRes.json()) as { convos: Array<{ id: string; unreadCount: number; members: Array<{ did: string; handle?: string; displayName?: string; avatar?: string }> }> };

    for (const convo of list.convos ?? []) {
      if (!convo.unreadCount) continue;
      const other = convo.members.find((m) => m.did !== account.platformAccountId);
      if (!other) continue;

      const msgUrl = new URL(`${BLUESKY_XRPC}/chat.bsky.convo.getMessages`);
      msgUrl.searchParams.set('convoId', convo.id);
      msgUrl.searchParams.set('limit', String(RECENT_EVENTS_LIMIT));
      const msgRes = await socialFetch(msgUrl.toString(), { platform: 'bluesky', headers: { Authorization: `Bearer ${accessToken}`, ...CHAT_PROXY_HEADER } });
      const msgs = (await msgRes.json()) as { messages: Array<{ id: string; sender: { did: string }; text: string; sentAt: string }> };

      for (const msg of msgs.messages ?? []) {
        if (msg.sender.did === account.platformAccountId) continue;
        await this.recordAndNotify({
          tenantId: account.tenantId,
          channel: 'bluesky',
          provider: 'bluesky',
          senderKind: 'social_account',
          senderKey: account.id,
          socialAccountId: account.id,
          contactExternalId: other.did,
          contactHandle: other.handle ?? null,
          contactName: other.displayName ?? null,
          contactAvatarUrl: other.avatar ?? null,
          direction: 'inbound',
          body: msg.text ?? null,
          status: 'received',
          externalId: msg.id,
          platformCreatedAt: new Date(msg.sentAt),
        });
      }
    }

    await this.clearPollError(account);
  }

  // ─── Mastodon ───────────────────────────────────────────────────────

  private async pollMastodon(account: SocialAccount): Promise<void> {
    const secrets = await this.tokens.getSecrets(account);
    const host = secrets?.instance as string | undefined;
    if (!host) return;

    const accessToken = await this.tokens.getAccessToken(account);
    const url = new URL(`https://${host}/api/v1/conversations`);
    url.searchParams.set('limit', String(RECENT_EVENTS_LIMIT));
    const res = await socialFetch(url.toString(), { platform: 'mastodon', headers: { Authorization: `Bearer ${accessToken}` } });
    const conversations = (await res.json()) as Array<{
      id: string;
      unread: boolean;
      accounts: Array<{ id: string; acct: string; display_name?: string; avatar?: string }>;
      last_status: { id: string; account: { id: string }; content: string; created_at: string } | null;
    }>;

    for (const convo of conversations) {
      if (!convo.unread || !convo.last_status) continue;
      if (convo.last_status.account.id === account.platformAccountId) continue; // last message in the thread was ours
      const other = convo.accounts.find((a) => a.id === convo.last_status!.account.id) ?? convo.accounts[0];
      if (!other) continue;

      await this.recordAndNotify({
        tenantId: account.tenantId,
        channel: 'mastodon',
        provider: 'mastodon',
        senderKind: 'social_account',
        senderKey: account.id,
        socialAccountId: account.id,
        contactExternalId: other.id,
        contactHandle: other.acct,
        contactName: other.display_name ?? null,
        contactAvatarUrl: other.avatar ?? null,
        direction: 'inbound',
        body: convo.last_status.content.replace(/<[^>]+>/g, ''), // strip Mastodon's HTML status body down to plain text
        status: 'received',
        externalId: convo.last_status.id,
        platformCreatedAt: new Date(convo.last_status.created_at),
      });
    }

    await this.clearPollError(account);
  }

  // ─── shared ─────────────────────────────────────────────────────────

  private async recordAndNotify(input: NormalizedInboxMessage): Promise<void> {
    const { conversation } = await this.ingest.recordInboxMessage(input);
    await this.realtime.emit(input.tenantId, 'inbox:message', { conversationId: conversation.id });
    await this.realtime.emit(input.tenantId, 'inbox:conversation', { conversationId: conversation.id });
  }

  private async clearPollError(account: SocialAccount): Promise<void> {
    if (account.lastErrorMsg) {
      await this.prisma.socialAccount.update({ where: { id: account.id }, data: { lastErrorMsg: null, lastErrorAt: null } }).catch(() => undefined);
    }
  }

  /** X's free/basic API tiers 403 on DM endpoints — log once per account (not every 2 min) by comparing against the last recorded error instead of a fresh warning each tick. */
  private async handlePollError(account: SocialAccount, err: Error): Promise<void> {
    const message = err.message;
    if (account.lastErrorMsg === message) return; // already logged and recorded — stay quiet until it changes
    this.logger.warn(`poll ${account.platform} account=${account.id}: ${message}`);
    await this.prisma.socialAccount.update({ where: { id: account.id }, data: { lastErrorAt: new Date(), lastErrorMsg: message } }).catch(() => undefined);
  }
}
