/**
 * Social Suite — the shared contract between htownautos-backend and htownautos-frontend.
 *
 * Source of truth: htownautos-backend/docs/social-suite/contract.ts
 * The frontend keeps a VERBATIM copy at
 *   htownautos-frontend/src/pages/dashboard/social-media/lib/contract.ts
 * Any change must be made in both files and reported to the main agent.
 *
 * Wire format: JSON. Dates are ISO-8601 strings, ids are uuid strings, money
 * never appears here. `null` means "known to be empty"; optional (`?`) means
 * "may be omitted in requests". Responses always include every field.
 *
 * Endpoints, behaviour and ownership live in CONTRACT.md next to this file.
 */

// ─── Shared primitives ──────────────────────────────────────────────────────

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface UserSummary {
  id: string
  name: string | null
  email: string
  avatar: string | null
}

/** Body of every 400 raised by post / idea validation. */
export interface ValidationErrorBody {
  statusCode: 400
  message: string
  errors: FieldError[]
}

export interface FieldError {
  /** Which channel the error belongs to; null = the post as a whole. */
  accountId: string | null
  /** Dotted path: "content", "mediaIds", "options.youtube.title", "thread.1.content" */
  field: string
  /** Stable machine code, e.g. TOO_LONG, MEDIA_REQUIRED, VIDEO_REQUIRED, TOO_MANY_IMAGES */
  code: string
  message: string
}

// ─── Platforms, channels, capabilities ──────────────────────────────────────

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "threads"
  | "x"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "pinterest"
  | "bluesky"
  | "mastodon"
  | "gbp"
  | "whatsapp"

/** Platforms a post can be published to (WhatsApp is messaging only). */
export type PublishablePlatform = Exclude<SocialPlatform, "whatsapp">

export type AccountType =
  | "page" // facebook page
  | "group" // facebook group (reminder publishing only)
  | "business" // instagram business, tiktok business
  | "creator" // instagram creator
  | "personal" // instagram personal, tiktok personal (reminder if the API can't publish)
  | "profile" // x, threads, bluesky, mastodon, linkedin member, pinterest
  | "organization" // linkedin company page
  | "channel" // youtube
  | "location" // google business profile location
  | "phone_number" // whatsapp business number

/**
 * api      — we publish through the platform API.
 * reminder — the platform has no publishing API for this account type (Facebook
 *            groups, Instagram personal…): at the scheduled time the team gets
 *            a notification with the content and marks it published by hand.
 * none     — the channel can't publish at all (WhatsApp).
 */
export type PublishMethod = "api" | "reminder" | "none"

/** expired = token dead, user must reconnect. error = last call failed. */
export type AccountStatus = "active" | "expired" | "error" | "disconnected"

export interface AccountCapabilities {
  publish: boolean
  comments: boolean
  mentions: boolean
  reviews: boolean
  messages: boolean
  analytics: boolean
}

export interface SocialAccount {
  id: string
  platform: SocialPlatform
  accountType: AccountType | null
  publishMethod: PublishMethod
  status: AccountStatus
  platformAccountId: string
  name: string
  username: string | null
  avatarUrl: string | null
  profileUrl: string | null
  capabilities: AccountCapabilities
  /** Timezone of this channel's posting schedule. */
  timezone: string
  queuePaused: boolean
  needsReconnect: boolean
  isActive: boolean
  scopes: string[]
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  lastErrorMsg: string | null
  createdAt: string
}

export type AccountSummary = Pick<
  SocialAccount,
  "id" | "platform" | "accountType" | "publishMethod" | "status" | "name" | "username" | "avatarUrl"
>

/** GET /social-accounts/oauth-url → { url }. The state inside the URL is signed. */
export interface OAuthUrlResponse {
  url: string
}

/**
 * POST /social-accounts/connect. The platform comes from the verified state;
 * `platform` in the body is accepted but ignored when it disagrees.
 */
export interface ConnectRequest {
  code: string
  state: string
  redirectUri: string
  platform?: SocialPlatform
}

/**
 * Signed OAuth state: `${base64url(JSON.stringify(OAuthStatePayload))}.${base64url(hmacSha256)}`.
 * The frontend MAY decode the first segment to show which platform is connecting,
 * but must always send the whole state back untouched.
 */
export interface OAuthStatePayload {
  platform: SocialPlatform
  tenantId: string
  userId: string
  nonce: string
  /** epoch ms */
  exp: number
  accountType?: AccountType
  /** mastodon only */
  instance?: string
}

export interface ConnectBlueskyRequest {
  identifier: string
  appPassword: string
}

export interface MastodonStartRequest {
  /** e.g. "mastodon.social" — no scheme */
  instance: string
  redirectUri: string
}

export interface WhatsAppEmbeddedSignupRequest {
  /** code returned by the Facebook JS SDK Embedded Signup */
  code: string
  wabaId?: string
  phoneNumberId?: string
}

/** Admin-only fallback when Embedded Signup isn't available. */
export interface WhatsAppManualConnectRequest {
  wabaId: string
  phoneNumberId: string
  accessToken: string
}

/** A channel we can't reach by API: only reminder publishing. */
export interface ReminderChannelRequest {
  platform: PublishablePlatform
  accountType: AccountType
  name: string
  username?: string
  profileUrl?: string
}

export interface UpdateAccountRequest {
  name?: string
  timezone?: string
  queuePaused?: boolean
}

export interface PinterestBoard {
  id: string
  name: string
}

// ─── Per-platform rules (the composer validates with these, the API enforces them) ─

export interface PlatformLimits {
  label: string
  /** Main text limit (caption / description / post body). */
  maxChars: number
  /** x-weighted = X's weighted count (URLs = 23, CJK = 2). graphemes = Bluesky. */
  countMode: "chars" | "graphemes" | "x-weighted"
  titleMaxChars: number | null
  maxImages: number
  maxVideos: number
  maxDocuments: number
  /** true = images and videos can be mixed in one post (carousels). */
  allowsMixedMedia: boolean
  requiresMedia: boolean
  requiresVideo: boolean
  supportsThread: boolean
  supportsFirstComment: boolean
  maxHashtags: number | null
}

export const PLATFORM_LIMITS: Record<PublishablePlatform, PlatformLimits> = {
  facebook: { label: "Facebook", maxChars: 63206, countMode: "chars", titleMaxChars: null, maxImages: 10, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: false, supportsFirstComment: true, maxHashtags: null },
  instagram: { label: "Instagram", maxChars: 2200, countMode: "chars", titleMaxChars: null, maxImages: 10, maxVideos: 10, maxDocuments: 0, allowsMixedMedia: true, requiresMedia: true, requiresVideo: false, supportsThread: false, supportsFirstComment: true, maxHashtags: 30 },
  threads: { label: "Threads", maxChars: 500, countMode: "chars", titleMaxChars: null, maxImages: 20, maxVideos: 20, maxDocuments: 0, allowsMixedMedia: true, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: 1 },
  x: { label: "X", maxChars: 280, countMode: "x-weighted", titleMaxChars: null, maxImages: 4, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: null },
  linkedin: { label: "LinkedIn", maxChars: 3000, countMode: "chars", titleMaxChars: null, maxImages: 20, maxVideos: 1, maxDocuments: 1, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: false, supportsFirstComment: true, maxHashtags: null },
  tiktok: { label: "TikTok", maxChars: 2200, countMode: "chars", titleMaxChars: 90, maxImages: 35, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: true, requiresVideo: false, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
  youtube: { label: "YouTube", maxChars: 5000, countMode: "chars", titleMaxChars: 100, maxImages: 0, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: true, requiresVideo: true, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
  pinterest: { label: "Pinterest", maxChars: 500, countMode: "chars", titleMaxChars: 100, maxImages: 5, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: true, requiresVideo: false, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
  bluesky: { label: "Bluesky", maxChars: 300, countMode: "graphemes", titleMaxChars: null, maxImages: 4, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: null },
  mastodon: { label: "Mastodon", maxChars: 500, countMode: "chars", titleMaxChars: null, maxImages: 4, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: null },
  gbp: { label: "Google Business", maxChars: 1500, countMode: "chars", titleMaxChars: null, maxImages: 1, maxVideos: 0, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
}

/** Per-platform options, keyed by platform. A target only reads the key of its own platform. */
export interface PlatformOptions {
  instagram?: { postType: "post" | "reel" | "story"; shareReelToFeed?: boolean; collaborators?: string[] }
  facebook?: { postType: "post" | "reel" | "story" }
  youtube?: {
    title: string
    privacy: "public" | "unlisted" | "private"
    categoryId?: string
    madeForKids: boolean
    tags?: string[]
    notifySubscribers?: boolean
  }
  tiktok?: {
    privacyLevel: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY"
    disableComment: boolean
    disableDuet: boolean
    disableStitch: boolean
    /** Commercial content disclosure — TikTok requires these to be asked explicitly. */
    brandContentToggle: boolean
    brandOrganicToggle: boolean
    isAigc?: boolean
    /** photo posts only */
    title?: string
  }
  pinterest?: { boardId: string; title?: string; link?: string }
  linkedin?: { visibility?: "PUBLIC" | "CONNECTIONS"; documentTitle?: string }
  gbp?: {
    topicType: "STANDARD" | "EVENT" | "OFFER"
    ctaType?: "BOOK" | "ORDER" | "SHOP" | "LEARN_MORE" | "SIGN_UP" | "CALL"
    ctaUrl?: string
    event?: { title: string; startAt: string; endAt: string }
    offer?: { couponCode?: string; redeemUrl?: string; terms?: string }
  }
  x?: { replySettings?: "everyone" | "following" | "mentionedUsers" }
  mastodon?: { visibility: "public" | "unlisted" | "private" | "direct"; spoilerText?: string; sensitive?: boolean; language?: string }
  bluesky?: { langs?: string[] }
  threads?: { replyControl?: "everyone" | "accounts_you_follow" | "mentioned_only" }
}

// ─── Media ──────────────────────────────────────────────────────────────────

export type MediaKind = "image" | "video" | "gif" | "document"

export interface SocialMediaItem {
  id: string
  kind: MediaKind
  mimeType: string
  fileName: string | null
  sizeBytes: number
  width: number | null
  height: number | null
  durationSec: number | null
  altText: string | null
  /** Signed GET URL (~1 h). Never store it: ask the API again. */
  url: string
  thumbnailUrl: string | null
  createdAt: string
}

export interface MediaUploadUrlRequest {
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface MediaUploadUrlResponse {
  key: string
  uploadUrl: string
  method: "PUT"
  /** Send exactly these headers with the PUT. */
  headers: Record<string, string>
  expiresAt: string
}

/** Register the object after the PUT succeeded. Width/height/duration are measured in the browser. */
export interface RegisterMediaRequest {
  key: string
  fileName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  durationSec?: number
  altText?: string
  /** Key of a poster frame the browser captured and uploaded the same way. */
  thumbnailKey?: string
}

// ─── Posts ──────────────────────────────────────────────────────────────────

export type PostStatus = "draft" | "pending_approval" | "scheduled" | "publishing" | "published" | "partial" | "failed"

export type TargetStatus =
  | "draft"
  | "pending_approval"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  /** reminder channel whose time has come: waiting for someone to post it by hand */
  | "reminder_due"
  | "cancelled"

/**
 * draft  — no time.
 * queue  — next free slot of each channel's posting schedule.
 * next   — first slot; the channel's other queued posts move down one slot.
 * now    — publish immediately.
 * custom — at `scheduledAt`.
 */
export type ScheduleMode = "draft" | "queue" | "next" | "now" | "custom"

export interface ThreadItem {
  content: string
  mediaIds: string[]
}

export interface PostMetrics {
  impressions: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  clicks: number | null
  videoViews: number | null
  /** 0..1 */
  engagementRate: number | null
}

export interface PostTarget {
  id: string
  accountId: string
  account: AccountSummary
  status: TargetStatus
  publishMethod: PublishMethod
  /** Override of the post text for this channel; null = uses the post text. */
  content: string | null
  /** Override of the post media for this channel; null = uses the post media. */
  mediaIds: string[] | null
  media: SocialMediaItem[] | null
  options: PlatformOptions
  thread: ThreadItem[]
  firstComment: string | null
  scheduledAt: string | null
  publishedAt: string | null
  externalId: string | null
  externalUrl: string | null
  error: string | null
  attempts: number
  metrics: PostMetrics | null
  metricsUpdatedAt: string | null
}

export interface SocialPost {
  id: string
  status: PostStatus
  content: string
  mediaIds: string[]
  media: SocialMediaItem[]
  tags: SocialTag[]
  scheduleMode: ScheduleMode
  /** Earliest target time. */
  scheduledAt: string | null
  aiGenerated: boolean
  ideaId: string | null
  createdBy: UserSummary | null
  approvedBy: UserSummary | null
  approvedAt: string | null
  rejectionNote: string | null
  targets: PostTarget[]
  createdAt: string
  updatedAt: string
}

export interface TargetInput {
  accountId: string
  content?: string | null
  mediaIds?: string[] | null
  options?: PlatformOptions
  thread?: ThreadItem[]
  firstComment?: string | null
}

export interface CreatePostRequest {
  content: string
  mediaIds?: string[]
  tagIds?: string[]
  ideaId?: string
  aiGenerated?: boolean
  mode: ScheduleMode
  /** required when mode = custom */
  scheduledAt?: string
  targets: TargetInput[]
}

export type UpdatePostRequest = Partial<CreatePostRequest>

export type PublishTab = "queue" | "drafts" | "approvals" | "sent"

/** Query string of GET /social/posts. Arrays travel as comma-separated ids. */
export interface PostListQuery {
  tab?: PublishTab
  accountIds?: string
  tagIds?: string
  /** ISO range over the target times — used by the calendar (then `limit` may go up to 500). */
  from?: string
  to?: string
  q?: string
  page?: number
  limit?: number
}

export interface RescheduleRequest {
  scheduledAt: string
  /** Only this channel; omitted = every not-yet-published target of the post. */
  targetId?: string
}

export interface RejectRequest {
  note: string
}

export interface MarkPublishedRequest {
  externalUrl?: string
}

/** GET /social/queue/slots — empty slots for the list view ("+ New" rows). */
export interface QueueSlot {
  accountId: string
  at: string
}

// ─── Posting schedules & goals ──────────────────────────────────────────────

export interface ScheduleSlot {
  /** 0 = Sunday … 6 = Saturday, in the schedule's timezone. */
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6
  /** "HH:mm", 24 h */
  time: string
}

export interface PostingSchedule {
  accountId: string
  timezone: string
  paused: boolean
  slots: ScheduleSlot[]
}

export interface SocialGoal {
  accountId: string
  postsPerWeek: number
}

// ─── Organising: tags, templates, hashtags, ideas, feeds ────────────────────

export interface SocialTag {
  id: string
  name: string
  /** "#RRGGBB" */
  color: string
}

export interface SocialTemplate {
  id: string
  name: string
  content: string
  category: string | null
  /** Built-ins have ids "builtin:<slug>" and can't be edited or deleted. */
  builtIn: boolean
}

export interface HashtagGroup {
  id: string
  name: string
  /** Space-separated, each starting with # */
  hashtags: string
}

export interface IdeaGroup {
  id: string
  name: string
  position: number
}

export interface SocialIdea {
  id: string
  /** null = "Unassigned" column */
  groupId: string | null
  title: string
  content: string
  mediaIds: string[]
  media: SocialMediaItem[]
  tags: SocialTag[]
  position: number
  sourceUrl: string | null
  createdBy: UserSummary | null
  createdAt: string
  updatedAt: string
}

export interface IdeaInput {
  title: string
  content?: string
  mediaIds?: string[]
  tagIds?: string[]
  groupId?: string | null
  position?: number
  sourceUrl?: string
}

export interface MoveIdeaRequest {
  groupId: string | null
  position: number
}

export interface GenerateIdeasRequest {
  prompt: string
  count?: number
  platform?: PublishablePlatform
}

export interface IdeaSuggestion {
  title: string
  content: string
}

export interface SocialFeed {
  id: string
  url: string
  title: string | null
  siteUrl: string | null
  lastFetchedAt: string | null
  lastError: string | null
  itemCount: number
}

export interface SocialFeedItem {
  id: string
  feedId: string
  title: string
  link: string
  summary: string | null
  imageUrl: string | null
  publishedAt: string | null
}

// ─── AI assistant ───────────────────────────────────────────────────────────

export type AiComposeAction = "generate" | "rephrase" | "shorten" | "expand" | "fix" | "hashtags" | "translate" | "tone"

export interface AiComposeRequest {
  action: AiComposeAction
  /** The current text (every action but "generate"). */
  text?: string
  /** What to write about ("generate"). */
  prompt?: string
  platform?: PublishablePlatform
  tone?: "professional" | "friendly" | "funny" | "persuasive" | "casual"
  /** BCP-47, e.g. "es", "en" ("translate") */
  language?: string
}

export interface AiComposeResponse {
  text: string
  alternatives: string[]
}

export interface AiReplyRequest {
  conversationId?: string
  commentId?: string
}

export interface AiReplyResponse {
  suggestions: string[]
}

// ─── Community: comments, mentions, reviews ─────────────────────────────────

export type CommentKind = "comment" | "mention" | "review"
export type CommentStatus = "open" | "done"

export interface SocialComment {
  id: string
  accountId: string
  account: AccountSummary
  platform: SocialPlatform
  kind: CommentKind
  status: CommentStatus
  externalId: string
  /** Our id of the parent comment, when this is a reply. */
  parentId: string | null
  /** Set when the comment is on a post published from here. */
  postTargetId: string | null
  postPreview: { text: string | null; mediaUrl: string | null; url: string | null } | null
  authorName: string
  authorHandle: string | null
  authorAvatarUrl: string | null
  authorExternalId: string | null
  body: string
  permalink: string | null
  /** reviews only, 1..5 */
  rating: number | null
  fromUs: boolean
  isHidden: boolean
  likedByUs: boolean
  replyCount: number
  repliedAt: string | null
  canReply: boolean
  canLike: boolean
  canHide: boolean
  canDelete: boolean
  /** When it was posted on the platform. */
  createdAt: string
}

export interface CommentListQuery {
  kind?: CommentKind
  status?: CommentStatus | "all"
  accountIds?: string
  platform?: SocialPlatform
  postTargetId?: string
  q?: string
  page?: number
  limit?: number
}

export interface CommentThread {
  root: SocialComment
  replies: SocialComment[]
}

export interface CommentReplyRequest {
  text: string
}

export interface CommentStats {
  open: number
  done: number
  /** 0..100 — share of the last 30 days' comments that got a reply or were marked done. */
  commentScore: number
  avgResponseMinutes: number | null
}

// ─── Unified inbox: DMs + SMS/MMS + WhatsApp ────────────────────────────────

export type InboxChannel = "sms" | "whatsapp" | "messenger" | "instagram" | "x" | "bluesky" | "mastodon"
export type InboxProvider = "twilio" | "meta" | "x" | "bluesky" | "mastodon"
export type ConversationStatus = "open" | "done"
export type MessageDirection = "inbound" | "outbound"
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed" | "received"

export interface InboxAttachment {
  kind: "image" | "video" | "audio" | "file" | "sticker" | "location"
  /** Signed or public URL, ready to render. */
  url: string
  mimeType: string | null
  name: string | null
}

/** Who sends on our side: a Twilio number or a connected account. */
export interface InboxSender {
  kind: "twilio_number" | "social_account"
  id: string
  label: string
  channels: InboxChannel[]
  phoneNumber: string | null
  account: AccountSummary | null
}

export interface InboxConversation {
  id: string
  channel: InboxChannel
  provider: InboxProvider
  sender: { kind: InboxSender["kind"]; id: string; label: string }
  contact: {
    name: string | null
    handle: string | null
    phone: string | null
    avatarUrl: string | null
    externalId: string
  }
  buyer: { id: string; name: string } | null
  status: ConversationStatus
  assignedTo: UserSummary | null
  unreadCount: number
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastDirection: MessageDirection | null
  /** false when the platform won't accept a reply right now. */
  canReply: boolean
  /** Messenger / Instagram / WhatsApp: end of the 24 h customer-service window. */
  windowExpiresAt: string | null
  /** WhatsApp outside the window: only an approved template can be sent. */
  replyRequiresTemplate: boolean
  createdAt: string
}

export interface ConversationListQuery {
  channel?: InboxChannel
  senderId?: string
  status?: ConversationStatus | "all"
  /** "me" | "unassigned" | a user id */
  assignedTo?: string
  unread?: boolean
  q?: string
  page?: number
  limit?: number
}

export interface InboxMessage {
  id: string
  conversationId: string
  direction: MessageDirection
  body: string | null
  attachments: InboxAttachment[]
  status: MessageStatus
  error: string | null
  sentBy: UserSummary | null
  externalId: string | null
  /** When it happened on the platform. */
  createdAt: string
  deliveredAt: string | null
  readAt: string | null
}

/** GET /inbox/conversations/:id/messages?before=<messageId>&limit=50 — newest last. */
export interface MessagePage {
  data: InboxMessage[]
  hasMore: boolean
}

export interface WhatsAppTemplateInput {
  name: string
  language: string
  variables: string[]
}

export interface SendMessageRequest {
  text?: string
  mediaIds?: string[]
  template?: WhatsAppTemplateInput
}

export interface StartConversationRequest {
  channel: "sms" | "whatsapp"
  senderId: string
  /** E.164 */
  to: string
  text?: string
  mediaIds?: string[]
  template?: WhatsAppTemplateInput
}

export interface UpdateConversationRequest {
  status?: ConversationStatus
  assignedToId?: string | null
  buyerId?: string | null
}

export interface WhatsAppTemplate {
  name: string
  language: string
  category: string
  status: string
  bodyText: string
  variableCount: number
}

export interface UnreadCounts {
  total: number
  byChannel: Partial<Record<InboxChannel, number>>
}

// ─── Insights ───────────────────────────────────────────────────────────────

export interface InsightsQuery {
  accountIds?: string
  /** YYYY-MM-DD */
  from: string
  to: string
}

export interface InsightsOverview {
  range: { from: string; to: string }
  totals: {
    followers: number | null
    followersChange: number | null
    impressions: number | null
    reach: number | null
    engagements: number | null
    /** 0..1 */
    engagementRate: number | null
    posts: number
    clicks: number | null
  }
  series: { date: string; followers: number | null; impressions: number | null; engagements: number | null }[]
  byAccount: {
    account: AccountSummary
    followers: number | null
    followersChange: number | null
    impressions: number | null
    engagements: number | null
    posts: number
  }[]
}

export interface PostInsightsQuery extends InsightsQuery {
  sort?: "date" | "impressions" | "engagements" | "engagementRate"
  page?: number
  limit?: number
}

/** One row per published target. */
export interface PostInsightRow {
  post: Pick<SocialPost, "id" | "content"> & { mediaUrl: string | null }
  target: Pick<PostTarget, "id" | "accountId" | "account" | "publishedAt" | "externalUrl" | "metrics">
}

export interface BestTimeCell {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6
  hour: number
  /** 0..1, relative within the account */
  score: number
  posts: number
}

export interface BestTimes {
  accountId: string
  timezone: string
  /** history = computed from our own published posts; default = platform defaults (too few posts). */
  source: "history" | "default"
  cells: BestTimeCell[]
}

// ─── Home ───────────────────────────────────────────────────────────────────

export interface SocialHome {
  /** Consecutive weeks (current one included if it already has a post) with ≥ 1 published post. */
  weekStreak: number
  goals: { accountId: string; account: AccountSummary; target: number; done: number }[]
  /** 0..100, same as CommentStats.commentScore */
  commentScore: number
  counts: {
    queue: number
    drafts: number
    approvals: number
    sentLast7d: number
    failed: number
    openComments: number
    unreadMessages: number
  }
  upNext: SocialPost[]
  recentComments: SocialComment[]
  firstSteps: { channelConnected: boolean; postCreated: boolean; apiKeyCreated: boolean }
}

// ─── Settings ───────────────────────────────────────────────────────────────

export interface SocialSettings {
  approvalRequired: boolean
  defaultTimezone: string
  shortenLinks: boolean
  utm: { enabled: boolean; source: string | null; medium: string; campaign: string | null }
  /** computed for the caller */
  canApprove: boolean
  /** computed for the caller: their posts go to Approvals */
  needsApproval: boolean
}

export type UpdateSocialSettingsRequest = Partial<Omit<SocialSettings, "canApprove" | "needsApproval">>

// ─── Start Page (link in bio) ───────────────────────────────────────────────

export type StartBlockType = "link" | "header" | "text" | "image" | "social" | "video" | "divider"

export interface StartBlock {
  id: string
  type: StartBlockType
  label?: string
  url?: string
  text?: string
  mediaId?: string
  /** resolved on read */
  imageUrl?: string
  platform?: SocialPlatform
  enabled: boolean
}

export interface StartTheme {
  background: string
  textColor: string
  buttonColor: string
  buttonTextColor: string
  buttonStyle: "filled" | "outline" | "soft"
  font: "system" | "serif" | "mono" | "rounded"
  avatarShape: "circle" | "square"
}

export interface StartPage {
  id: string
  /** lowercase a-z 0-9 and "-", 3..40, globally unique */
  slug: string
  title: string
  bio: string | null
  avatarMediaId: string | null
  avatarUrl: string | null
  theme: StartTheme
  blocks: StartBlock[]
  published: boolean
  /** https://app.htownautos.com/start/<slug> */
  publicUrl: string
  createdAt: string
  updatedAt: string
}

export type StartPageInput = Partial<Pick<StartPage, "slug" | "title" | "bio" | "avatarMediaId" | "theme" | "blocks">>

export interface StartPageStats {
  views: number
  clicks: number
  /** 0..1 */
  ctr: number
  series: { date: string; views: number; clicks: number }[]
  byBlock: { blockId: string; label: string | null; clicks: number }[]
}

/** GET /public/start/:slug — no auth. Only published pages, only enabled blocks. */
export interface PublicStartPage {
  slug: string
  title: string
  bio: string | null
  avatarUrl: string | null
  theme: StartTheme
  blocks: StartBlock[]
}

export interface StartPageEventRequest {
  type: "view" | "click"
  blockId?: string
}

// ─── Realtime (Socket.IO namespace /presence, room tenant:<tenantId>) ───────

export interface SocialRealtimeEvents {
  "inbox:message": { conversation: InboxConversation; message: InboxMessage }
  "inbox:conversation": { conversation: InboxConversation }
  "social:comment": { comment: SocialComment }
  "social:post": { postId: string; targetId: string; status: TargetStatus; error: string | null; externalUrl: string | null }
  "social:account": { account: SocialAccount }
}
