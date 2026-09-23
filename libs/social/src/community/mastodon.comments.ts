import { socialFetch, SocialApiError } from '../http/social-http';
import type { NormalizedComment } from '../ingest/social-ingest.service';
import type { CommunityAdapter, CommunityActionContext, FetchSinceOptions, FetchSinceResult, ReplyResult } from './types';

interface MastodonAccount {
  id: string;
  username: string;
  display_name?: string;
  avatar?: string;
  url?: string;
}

interface MastodonStatus {
  id: string;
  content: string;
  created_at: string;
  url?: string;
  in_reply_to_id?: string | null;
  in_reply_to_account_id?: string | null;
  account: MastodonAccount;
}

interface MastodonNotification {
  id: string;
  type: string;
  status?: MastodonStatus;
}

function instanceOf(ctx: CommunityActionContext): string {
  const host = ctx.secrets.instance as string | undefined;
  if (!host) throw new SocialApiError({ platform: 'mastodon', httpStatus: 0, kind: 'NOT_CONFIGURED', message: 'Cuenta de Mastodon sin instancia guardada — reconectar' });
  return host;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function toNormalized(tenantId: string, accountId: string, ourAccountId: string, status: MastodonStatus): NormalizedComment {
  return {
    tenantId,
    accountId,
    platform: 'mastodon',
    kind: status.in_reply_to_account_id === ourAccountId ? 'comment' : 'mention',
    externalId: status.id,
    externalParentId: status.in_reply_to_id ?? null,
    externalPostId: status.in_reply_to_account_id === ourAccountId ? status.in_reply_to_id ?? null : null,
    authorName: status.account.display_name || status.account.username,
    authorHandle: status.account.username,
    authorAvatarUrl: status.account.avatar ?? null,
    authorExternalId: status.account.id,
    body: status.content, // HTML, per Mastodon's API — rendered as-is by the frontend, same as the platform's own web UI.
    permalink: status.url ?? null,
    fromUs: false,
    platformCreatedAt: new Date(status.created_at),
  };
}

/**
 * Mastodon mention notifications (CONTRACT.md §1/§4) — 5 min poll,
 * account-level. Mastodon pages by status/notification id, not time, so the
 * cursor stored in `commentsSince` is the last seen notification id.
 */
export const mastodonCommentsAdapter: CommunityAdapter = {
  async fetchSince(ctx: CommunityActionContext, opts: FetchSinceOptions): Promise<FetchSinceResult> {
    const host = instanceOf(ctx);
    const url = new URL(`https://${host}/api/v1/notifications`);
    url.searchParams.set('types[]', 'mention');
    url.searchParams.set('limit', '40');
    if (opts.since) url.searchParams.set('since_id', opts.since);

    const res = await socialFetch(url.toString(), { platform: 'mastodon', headers: authHeaders(ctx.accessToken) });
    const notifications = (await res.json()) as MastodonNotification[];

    const items: NormalizedComment[] = [];
    let maxId = opts.since ?? '0';
    for (const n of notifications) {
      if (n.type !== 'mention' || !n.status) continue;
      items.push(toNormalized(ctx.account.tenantId, ctx.account.id, ctx.account.platformAccountId, n.status));
      if (BigInt(n.id) > BigInt(maxId)) maxId = n.id;
    }

    return { items, cursor: maxId };
  },

  async reply(ctx, comment, text): Promise<ReplyResult> {
    const host = instanceOf(ctx);
    const res = await socialFetch(`https://${host}/api/v1/statuses`, {
      platform: 'mastodon',
      method: 'POST',
      headers: { ...authHeaders(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: text, in_reply_to_id: comment.externalId }),
    });
    const data = (await res.json()) as { id: string; url?: string };
    return { externalId: data.id, permalink: data.url ?? null };
  },

  async like(ctx, comment): Promise<void> {
    const host = instanceOf(ctx);
    await socialFetch(`https://${host}/api/v1/statuses/${comment.externalId}/favourite`, {
      platform: 'mastodon',
      method: 'POST',
      headers: authHeaders(ctx.accessToken),
    });
  },

  async unlike(ctx, comment): Promise<void> {
    const host = instanceOf(ctx);
    await socialFetch(`https://${host}/api/v1/statuses/${comment.externalId}/unfavourite`, {
      platform: 'mastodon',
      method: 'POST',
      headers: authHeaders(ctx.accessToken),
    });
  },
};
