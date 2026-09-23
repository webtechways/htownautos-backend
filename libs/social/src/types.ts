/**
 * Shared types used across libs/social. Mirrors the relevant subset of
 * docs/social-suite/contract.ts — the wire contract stays the source of
 * truth; this file only copies what the lib itself needs to type-check
 * (capabilities, http classification, ingest normalization, realtime).
 */

export type SocialPlatform =
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'x'
  | 'linkedin'
  | 'tiktok'
  | 'youtube'
  | 'pinterest'
  | 'bluesky'
  | 'mastodon'
  | 'gbp'
  | 'whatsapp';

/** Platforms a post can be published to (WhatsApp is messaging only). */
export type PublishablePlatform = Exclude<SocialPlatform, 'whatsapp'>;

export type AccountType =
  | 'page'
  | 'group'
  | 'business'
  | 'creator'
  | 'personal'
  | 'profile'
  | 'organization'
  | 'channel'
  | 'location'
  | 'phone_number';

/**
 * api      — we publish through the platform API.
 * reminder — no publishing API for this account type: the team gets a
 *            notification at the scheduled time and marks it published by hand.
 * none     — the channel can't publish at all (WhatsApp).
 */
export type PublishMethod = 'api' | 'reminder' | 'none';

/** expired = token dead, user must reconnect. error = last call failed. */
export type AccountStatus = 'active' | 'expired' | 'error' | 'disconnected';

export interface AccountCapabilities {
  publish: boolean;
  comments: boolean;
  mentions: boolean;
  reviews: boolean;
  messages: boolean;
  analytics: boolean;
}

export type MediaKind = 'image' | 'video' | 'gif' | 'document';

export interface ThreadItem {
  content: string;
  mediaIds: string[];
}

export interface ScheduleSlot {
  /** 0 = Sunday … 6 = Saturday, in the schedule's timezone. */
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** "HH:mm", 24 h */
  time: string;
}

export interface PostMetrics {
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  videoViews: number | null;
  /** 0..1 */
  engagementRate: number | null;
}

export type CommentKind = 'comment' | 'mention' | 'review';
export type CommentStatus = 'open' | 'done';

export type InboxChannel = 'sms' | 'whatsapp' | 'messenger' | 'instagram' | 'x' | 'bluesky' | 'mastodon';
export type InboxProvider = 'twilio' | 'meta' | 'x' | 'bluesky' | 'mastodon';
export type ConversationStatus = 'open' | 'done';
export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';

/**
 * Realtime event names emitted through the Socket.IO `/presence` namespace,
 * room `tenant:<id>` — per docs/social-suite/contract.ts `SocialRealtimeEvents`.
 * Payload shapes are owned by whichever package assembles the DTO (posts,
 * comments, inbox); `SocialRealtimeService.emit` intentionally takes
 * `payload: unknown` rather than re-declaring those shapes here.
 */
export type SocialRealtimeEventName =
  | 'inbox:message'
  | 'inbox:conversation'
  | 'social:comment'
  | 'social:post'
  | 'social:account';
