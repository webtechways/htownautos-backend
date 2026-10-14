# Social Suite — contract

A Buffer-equivalent inside the CRM (**Social Media** menu) plus a unified inbox for
every DM channel and every Twilio number. Types are in `contract.ts` (same folder);
this file is the endpoints, the behaviour, and who owns what.

Branch in both repos: `feat/social-suite`. Nobody pushes; CI/CD ships it after QA and
the user's approval.

## 0. What exists today (don't rebuild it)

- `apps/api/src/social-accounts/` — OAuth connect for facebook, instagram (via FB
  login), tiktok, youtube, linkedin, pinterest, threads, gbp, bluesky (app
  password); `SocialGroup` CRUD. **No publishing, no comments, no DMs, no metrics.**
- `SocialAccount` stores `accessToken` / `refreshToken` **in plain text** (the
  comment says "encrypted" — it isn't). OAuth `state` is unsigned base64 JSON.
- Twilio: `apps/api/src/twilio/` + `apps/api/src/sms/`. Inbound SMS webhook
  `POST /twilio/sms/incoming/:tenantId/:phoneId` **drops every SMS whose sender
  isn't a known Buyer** (`sms.service.ts` → `handleIncomingSms`), never stores MMS
  media, and **never validates `X-Twilio-Signature`** (`TwilioService.validateWebhookSignature`
  exists and is unused). `SmsMessage.buyerId` is NOT NULL.
- Realtime: Socket.IO gateway `apps/api/src/presence/presence.gateway.ts`
  (namespace `/presence`, rooms `tenant:<id>`); `SmsEventsService` emits through it.
- Short links: `ShortUrl` + `short-url` module, served at `https://link.htownautos.com/<code>`.
- Notifications: `notifyTenantStaff` / `NotificationsService.create()` publish to
  chat channels (Telegram/Discord/Slack). Rule: **one notification per logical event,
  not per row.**
- Frontend: `/dashboard/social-media` lists accounts + groups; connecting happens in
  `Settings → Integrations` (`src/pages/settings/social-accounts-section.tsx`,
  OAuth return to `/dashboard/settings/integrations`). That page stays the place
  where OAuth returns.
- Global app credentials (rule): developer apps are the operator's, in the backend
  env. **Tenants never type app ids or secrets** — only "Connect" buttons. The one
  admin-only exception is the WhatsApp manual fallback.

## 1. Channels (what each platform can do)

| Platform | Connect | Publish | Comments / mentions / reviews | DMs | Analytics |
|---|---|---|---|---|---|
| Facebook Page | FB Login | post, photos, video, reel, story | webhook `feed` + poll backfill; reply, like, hide, delete | Messenger (webhook + Send API, 24 h window, HUMAN_AGENT tag ≤ 7 d) | page + post insights |
| Facebook Group | reminder channel (Meta removed group publishing in 2024) | reminder | — | — | — |
| Instagram Business/Creator | **Instagram Login** (preferred, no Page needed) or FB Login | image, carousel, reel, story, first comment | webhook `comments`/`mentions`; reply, hide, delete | IG Messaging (24 h window) | account + media insights |
| Instagram Personal | reminder channel | reminder | — | — | — |
| Threads | Threads OAuth | text, image, video, carousel, thread chains | replies + mentions (poll); reply, hide | — | insights |
| X | OAuth 2.0 PKCE (**new**) | text, ≤4 images or 1 video/GIF, threads | mentions (poll; needs a paid X API tier) | DMs (paid tier) | public metrics |
| LinkedIn | OAuth (member + organization) | text, images, video, document (PDF) | org comments (Community Management API — LinkedIn approval) | not available to third parties | org stats |
| TikTok | Login Kit | video, photo carousel (unaudited apps: SELF_ONLY) | not in Login Kit | not available | video stats, followers |
| YouTube | Google OAuth | video / Shorts (upload = 1 600 quota units of 10 000/day) | commentThreads (poll); reply, moderate | — | YouTube Analytics |
| Pinterest | OAuth | pin (image/video/carousel) on a board | — | — | pin + account analytics |
| Bluesky | app password | text, ≤4 images, 1 video, threads | notifications (reply/mention/quote) | chat.bsky (app password with DM access) | counts |
| Mastodon | per-instance OAuth, app registered on the fly (**new**) | text, ≤4 images, 1 video, threads, CW | mention notifications | direct conversations | counts |
| Google Business Profile | Google OAuth | STANDARD / EVENT / OFFER posts + CTA | **reviews** (list + reply) | — (Business Messages shut down 2024) | performance API |
| WhatsApp Business | Embedded Signup (**new**); admin manual fallback | — | — | Cloud API: text, media, templates (24 h window) | — |
| Twilio numbers | existing `TwilioPhoneNumber` rows | — | — | SMS, MMS, WhatsApp-via-Twilio (`From: whatsapp:+1…`) | — |

Rows marked "paid tier" / "approval" must still be fully implemented; the UI shows a
clear message when the platform rejects the call for that reason.

## 2. Conventions

- Prefix `/api/v1`. Guards are global (ApiKey → Clerk → Tenant). **Never `@UseGuards`.**
  Public endpoints use `@Public()`.
- Every social controller also declares API-key scopes (`social:read` / `social:write`,
  `inbox:read` / `inbox:write`) so the suite is scriptable with API keys — our
  "Buffer API". Register the two resources in `libs/auth/src/constants/api-scopes.ts`.
- Pagination: `?page=1&limit=20` → `Paginated<T>`. Csv for id lists (`accountIds=a,b`).
- Admin = role slug in `ADMIN_ROLES` (`owner`, `admin`, `manager`, `libs/auth/src/decorators/roles.decorator.ts`).
- Every tenant-owned query filters by `tenantId`; foreign ids in bodies
  (`accountId`, `mediaIds`, `tagIds`, `groupId`, `buyerId`, `assignedToId`) are checked
  to belong to the caller's tenant → otherwise 404.
- Tokens and any credential (access/refresh tokens, Bluesky app password, WhatsApp
  token, Mastodon client secret) are **encrypted at rest** (AES-256-GCM, key
  `SOCIAL_TOKEN_KEY`, value prefix `v1:`); reading a value without the prefix returns
  it as-is (legacy plaintext) and it is re-encrypted on the next write. Never
  returned by the API.
- Platform API versions: read the current docs (Context7 or the official reference)
  — do not rely on memory. Graph version from `META_GRAPH_VERSION` (default: the
  current stable one at the time you write the code).

## 3. Endpoints

### 3.1 Channels — `social-accounts` (extends the existing controller)

| Method & path | Body / query | Response |
|---|---|---|
| GET `/social-accounts` | | `SocialAccount[]` |
| GET `/social-accounts/:id` | | `SocialAccount` |
| GET `/social-accounts/oauth-url` | `platform, redirectUri, accountType?` | `OAuthUrlResponse` (signed state, 10 min) |
| POST `/social-accounts/connect` | `ConnectRequest` | `SocialAccount[]` |
| POST `/social-accounts/connect/bluesky` | `ConnectBlueskyRequest` | `SocialAccount[]` |
| POST `/social-accounts/connect/mastodon/start` | `MastodonStartRequest` | `OAuthUrlResponse` (then back through `/connect`) |
| POST `/social-accounts/connect/whatsapp` | `WhatsAppEmbeddedSignupRequest` | `SocialAccount[]` |
| POST `/social-accounts/connect/whatsapp/manual` | `WhatsAppManualConnectRequest` (admin) | `SocialAccount[]` |
| POST `/social-accounts/connect/reminder` | `ReminderChannelRequest` | `SocialAccount` |
| PATCH `/social-accounts/:id` | `UpdateAccountRequest` | `SocialAccount` |
| POST `/social-accounts/:id/refresh` | | `SocialAccount` (profile + token refresh) |
| DELETE `/social-accounts/:id` | | `{ message }` — cancels its scheduled targets |
| GET `/social-accounts/:id/boards` | | `PinterestBoard[]` |
| groups endpoints | unchanged | unchanged |

OAuth redirect URI registered in every developer app:
`https://app.htownautos.com/dashboard/settings/integrations` and
`https://dev-app.htownautos.com/dashboard/settings/integrations`.
Facebook Pages: subscribe the page to the app webhook (`subscribed_apps`) at connect time.

### 3.2 Media — `social/media`

| POST `/social/media/upload-url` | `MediaUploadUrlRequest` | `MediaUploadUrlResponse` (presigned PUT, **private** bucket, prefix `social/<tenantId>/`) |
| POST `/social/media` | `RegisterMediaRequest` | `SocialMediaItem` |
| GET `/social/media` | `page, limit` | `Paginated<SocialMediaItem>` |
| PATCH `/social/media/:id` | `{ altText }` | `SocialMediaItem` |
| DELETE `/social/media/:id` | | 409 if a not-yet-published post or idea uses it |

Limits: image ≤ 20 MB, video ≤ 1 GB, document (PDF) ≤ 100 MB. Publishing gives the
platform a short-lived signed URL, or streams the bytes for upload-style APIs; the
publisher converts images to JPEG / resizes when a platform needs it (sharp).

### 3.3 Posts, queue, approvals — `social/posts`, `social/queue`

| GET `/social/posts` | `PostListQuery` | `Paginated<SocialPost>` |
| GET `/social/posts/:id` | | `SocialPost` |
| POST `/social/posts` | `CreatePostRequest` | `SocialPost` · 400 `ValidationErrorBody` |
| PATCH `/social/posts/:id` | `UpdatePostRequest` | `SocialPost` (409 if any target is publishing/published) |
| DELETE `/social/posts/:id` | | `{ message }` |
| POST `/social/posts/:id/duplicate` | | `SocialPost` (draft) |
| POST `/social/posts/:id/publish-now` | | `SocialPost` |
| POST `/social/posts/:id/reschedule` | `RescheduleRequest` | `SocialPost` |
| POST `/social/posts/:id/request-approval` | | `SocialPost` |
| POST `/social/posts/:id/approve` | (admin) | `SocialPost` |
| POST `/social/posts/:id/reject` | `RejectRequest` (admin) | `SocialPost` (back to draft, note kept) |
| POST `/social/posts/:id/targets/:targetId/retry` | | `SocialPost` |
| POST `/social/posts/:id/targets/:targetId/mark-published` | `MarkPublishedRequest` | `SocialPost` |
| GET `/social/queue/slots` | `accountIds, from, to` | `QueueSlot[]` |
| POST `/social/queue/:accountId/shuffle` | | `{ moved: number }` |

Tabs: **queue** = scheduled + publishing + failed + reminder_due (failed first) ·
**drafts** = draft · **approvals** = pending_approval · **sent** = published + partial.

Rules:
- `mode=queue`: each target takes its channel's next free slot after now (free = no
  other target of that channel at that minute). No schedule → default slots
  Mon–Fri 09:00, 13:00, 17:00 in the tenant timezone (`America/Chicago` default).
- `mode=next`: first free-or-occupied slot; the channel's queue-mode targets from
  there on shift one slot later. Custom-time targets never move.
- `mode=now`: targets scheduled at now and handed to the publisher immediately.
- Approval: settings.approvalRequired && caller not admin → post and targets
  `pending_approval`; approval computes the slots then (queue/next), keeps custom
  times, and a custom time already past → publish now. Notify admins on request,
  author on approve/reject.
- A paused channel keeps its targets `scheduled`; the publisher skips them.
- Validation (400) uses `PLATFORM_LIMITS` + options: YouTube needs title + 1 video;
  Pinterest needs boardId; TikTok needs privacyLevel and the disclosure toggles;
  Instagram story/reel media rules; thread only where `supportsThread`.

### 3.4 Schedules, goals, settings, home

| GET `/social/schedules` | | `PostingSchedule[]` (one per publishable account, defaults filled) |
| PUT `/social/schedules/:accountId` | `PostingSchedule` minus accountId | `PostingSchedule` |
| GET `/social/goals` · PUT `/social/goals` | `SocialGoal[]` | `SocialGoal[]` |
| GET `/social/settings` · PATCH `/social/settings` | `UpdateSocialSettingsRequest` (admin) | `SocialSettings` |
| GET `/social/home` | | `SocialHome` |

### 3.5 Organising — tags, templates, hashtags, ideas, feeds, AI

| CRUD `/social/tags` | `{ name, color }` | `SocialTag` |
| CRUD `/social/templates` | `{ name, content, category? }` | `SocialTemplate` (GET merges ~12 built-ins, useful for a car dealer) |
| CRUD `/social/hashtag-groups` | `{ name, hashtags }` | `HashtagGroup` |
| GET `/social/idea-groups` · POST · PATCH `/:id` · DELETE `/:id` (ideas → Unassigned) · POST `/social/idea-groups/reorder` `{ ids }` | | `IdeaGroup[]` — first GET creates To Do / In Progress / Done |
| GET `/social/ideas` (`groupId, tagIds, q`) · POST · PATCH `/:id` · DELETE `/:id` | `IdeaInput` | `SocialIdea` |
| POST `/social/ideas/:id/move` | `MoveIdeaRequest` | `SocialIdea` |
| POST `/social/ideas/generate` | `GenerateIdeasRequest` | `IdeaSuggestion[]` (not saved) |
| CRUD `/social/feeds` | `{ url }` | `SocialFeed` (validates it is RSS/Atom; SSRF-safe: http(s) only, no private IPs) |
| GET `/social/feeds/items` | `feedId?, page, limit` | `Paginated<SocialFeedItem>` |
| POST `/social/feeds/:id/refresh` | | `SocialFeed` |
| POST `/social/ai/compose` | `AiComposeRequest` | `AiComposeResponse` |
| POST `/social/ai/reply-suggestion` | `AiReplyRequest` | `AiReplyResponse` |

AI: OpenAI client configured the way `apps/api/src/ai-chat/` does it; model from
`SOCIAL_AI_MODEL` (default: the one ai-chat uses). Throttled per user.

### 3.6 Community — `social/comments`

| GET `/social/comments` | `CommentListQuery` | `Paginated<SocialComment>` (top-level only) |
| GET `/social/comments/stats` | | `CommentStats` |
| GET `/social/comments/:id/thread` | | `CommentThread` |
| POST `/social/comments/:id/reply` | `CommentReplyRequest` | `SocialComment` (ours) |
| POST `/social/comments/:id/like` · `/unlike` · `/hide` · `/unhide` | | `SocialComment` |
| DELETE `/social/comments/:id` | | `{ message }` |
| PATCH `/social/comments/:id` | `{ status }` | `SocialComment` |
| POST `/social/comments/mark-done` | `{ ids: string[] }` | `{ updated: number }` |

Replying marks the root `done` and sets `repliedAt`. A new comment on a `done` thread reopens it.

### 3.7 Inbox — `inbox`

| GET `/inbox/conversations` | `ConversationListQuery` | `Paginated<InboxConversation>` (by lastMessageAt desc) |
| GET `/inbox/conversations/:id` | | `InboxConversation` |
| GET `/inbox/conversations/:id/messages` | `before?, limit?` | `MessagePage` |
| POST `/inbox/conversations/:id/messages` | `SendMessageRequest` | `InboxMessage` · 422 `{ code: "WINDOW_CLOSED" \| "TEMPLATE_REQUIRED" \| "NOT_SUPPORTED" }` |
| POST `/inbox/conversations` | `StartConversationRequest` | `InboxConversation` |
| PATCH `/inbox/conversations/:id` | `UpdateConversationRequest` | `InboxConversation` |
| POST `/inbox/conversations/:id/read` | | `InboxConversation` |
| GET `/inbox/unread-count` | | `UnreadCounts` |
| GET `/inbox/senders` | | `InboxSender[]` |
| GET `/inbox/whatsapp/templates` | `senderId` | `WhatsAppTemplate[]` |
| POST `/inbox/twilio/sync-webhooks` | (admin) | `{ updated: number, numbers: string[] }` — points every tenant Twilio number's SMS URL at our webhook |

Rules:
- One conversation per (tenant, channel, sender, contact). Messages are idempotent on
  (channel, externalId).
- SMS: **every inbound SMS/MMS is stored**, known buyer or not. Contact → Buyer by
  normalized phone; unknown numbers stay unlinked until someone links them. MMS media
  is copied to the private bucket (Twilio media URLs need auth). `SmsService` stays
  the only writer of `SmsMessage` and mirrors every SMS (in/out, status updates) into
  the inbox, so the customer page's SMS tab keeps working unchanged.
- Twilio webhooks validate `X-Twilio-Signature` against the public URL
  (`https://api.htownautos.com/...`, honour `x-forwarded-*`); invalid → 403.
  `TWILIO_VALIDATE_SIGNATURE=false` disables it (emergency switch only).
- Meta webhook `GET/POST /social/webhooks/meta` (`@Public()`): verify token
  `META_WEBHOOK_VERIFY_TOKEN`; `X-Hub-Signature-256` with the app secret(s); routes
  page / instagram / whatsapp_business_account objects to the account → tenant.
  Comments/mentions go to the community store, messages to the inbox.
- `assignedToId` in requests and `assignedTo.id` in responses are **User ids** (`UserSummary.id`); the table stores the TenantUser id — translate both ways in the service.
- Unread + notification: notify (one `SOCIAL_MESSAGE_RECEIVED`) only when a
  conversation goes from 0 to ≥ 1 unread — not per message.

### 3.8 Insights — `social/insights`

| GET `/social/insights/overview` | `InsightsQuery` | `InsightsOverview` |
| GET `/social/insights/posts` | `PostInsightsQuery` | `Paginated<PostInsightRow>` |
| GET `/social/insights/best-times` | `accountId` | `BestTimes` |
| GET `/social/insights/export` | `InsightsQuery & { format: "csv" }` | `text/csv` attachment |
| POST `/social/insights/sync` | `{ accountId? }` (admin) | `{ queued: number }` |

### 3.9 Start Page

| GET/POST `/social/start-pages` · GET/PATCH/DELETE `/:id` | `StartPageInput` | `StartPage` |
| POST `/social/start-pages/:id/publish` · `/unpublish` | | `StartPage` |
| GET `/social/start-pages/:id/stats` | `from, to` | `StartPageStats` |
| GET `/public/start/:slug` (`@Public()`) | | `PublicStartPage` / 404 |
| POST `/public/start/:slug/events` (`@Public()`, throttled) | `StartPageEventRequest` | 204 |

Stats are daily aggregates (increment), not one row per event.

### 3.10 Link shortening

When `settings.shortenLinks`, the publisher replaces each URL in the published text
with a `ShortUrl` (`https://link.htownautos.com/<code>`, new column
`ShortUrl.socialPostTargetId`) and appends UTM parameters when `utm.enabled`
(`utm_source` = platform unless set, `utm_medium`, `utm_campaign`). Clicks feed
`PostMetrics.clicks`.

## 4. Background work (apps/data-sync)

| Job | Cadence | Notes |
|---|---|---|
| Publisher | every 30 s + queue message `social.publish` for "now" | claim with `FOR UPDATE SKIP LOCKED`, max 3 attempts with backoff for transient errors (network/5xx/429), stale `publishing` > 30 min recovered; recompute post status; thread items and first comment after the main post; `social:post` realtime event |
| Reminders | same loop | reminder targets → `reminder_due` + notification `SOCIAL_REMINDER_DUE` with link `/dashboard/social-media/publish/reminder/<targetId>?post=<postId>` |
| Token refresh | hourly | refresh what expires in < 72 h; dead token → status `expired` + `SOCIAL_ACCOUNT_DISCONNECTED` (once) |
| DM pollers | 2 min | X, Bluesky, Mastodon |
| Comment pollers | 5 min | YouTube, Threads, LinkedIn, Bluesky, Mastodon, X, GBP reviews; FB/IG backfill 30 min |
| Metrics | account daily 03:00 Central; post metrics every 6 h for targets published < 30 d | respect quotas |
| RSS feeds | 30 min | |

Notification types to add (and route to chat channels like the rest):
`SOCIAL_POST_FAILED` (one per post, lists channels), `SOCIAL_REMINDER_DUE`,
`SOCIAL_APPROVAL_REQUESTED`, `SOCIAL_POST_APPROVED`, `SOCIAL_POST_REJECTED`,
`SOCIAL_ACCOUNT_DISCONNECTED`, `SOCIAL_MESSAGE_RECEIVED`, `SOCIAL_COMMENT_RECEIVED`
(batched per account per poll/webhook batch).

## 5. Environment (backend, Coolify)

Existing names are kept: `FACEBOOK_APP_ID/SECRET`, `INSTAGRAM_APP_ID/SECRET`,
`THREADS_APP_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `YOUTUBE_CLIENT_ID/SECRET`
(fallback `GOOGLE_CLIENT_ID/SECRET`), `GOOGLE_BUSINESS_CLIENT_ID/SECRET` (fallback
`GOOGLE_CLIENT_ID/SECRET`), `LINKEDIN_CLIENT_ID/SECRET`, `PINTEREST_APP_ID/SECRET`,
`TWILIO_*`. New: `X_CLIENT_ID`, `X_CLIENT_SECRET`, `WHATSAPP_CONFIG_ID`,
`META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_VERSION` (optional), `SOCIAL_TOKEN_KEY`
(32 bytes base64 — **required**), `OAUTH_STATE_SECRET` (**required**),
`SOCIAL_AI_MODEL` (optional), `PUBLIC_API_URL` (default `https://api.htownautos.com`),
`TWILIO_VALIDATE_SIGNATURE` (default true). A missing platform credential must
disable that platform with a clear 400 ("X no está configurado"), never crash.
Add every name to `.env.example` with a one-line comment.

## 6. Ownership (who may edit what)

Backend (`htownautos-backend`):

| Package | Owns |
|---|---|
| **B1 Foundation** | `libs/prisma/prisma/schema.prisma` + the ONE migration `20260923000000_social_suite`; `PrismaService` getters; `libs/social/` skeleton (crypto, oauth-state, http helper, errors, types, `PLATFORM_LIMITS` copy, ingest store, realtime events); module skeletons registered in `apps/api/src/app.module.ts` and the data-sync module; api-scopes; notification types; `apps/api/src/social/settings/` |
| **B2a Channels & publishing** | `apps/api/src/social-accounts/**`, `apps/api/src/social/media/**`, `libs/social/src/connect/**`, `libs/social/src/publish/**`, `libs/social/src/tokens/**`, `apps/data-sync/src/social/publisher*`, `.../token-refresh*`, `.../reminders*`, short-link rewriting |
| **B2b Planning** | `apps/api/src/social/{posts,queue,schedules,goals,home,tags,templates,hashtags,ideas,feeds,ai}/**`, `apps/data-sync/src/social/feeds*` |
| **B3 Inbox** | `apps/api/src/inbox/**`, `apps/api/src/social/webhooks/**`, `libs/social/src/messaging/**`, Twilio/SMS changes in `apps/api/src/{twilio,sms}/**`, `apps/data-sync/src/social/dm-poll*` |
| **B4 Community, insights, start page** | `apps/api/src/social/{comments,insights,start-pages}/**`, `apps/api/src/public-start/**`, `libs/social/src/community/**`, `libs/social/src/insights/**`, `apps/data-sync/src/social/{comment-poll,metrics}*` |

Frontend (`htownautos-frontend`) — scaffolding (routes, nav, layout, stubs,
`lib/contract.ts`, `composer-bridge.ts`) is done by the main agent first:

| Package | Owns (under `src/pages/dashboard/social-media/` unless noted) |
|---|---|
| **F1 Compose & publish** | `index.tsx` (Home), `layout.tsx`, `components/composer/**`, `components/post-card/**`, `publish/**`, i18n namespace `socialPublish` |
| **F2 Create & settings** | `create/**`, `settings/**`, `start-page/**`, `src/pages/public/start-page/**`, `src/components/integrations/**`, `src/pages/settings/social-accounts-section.tsx`, `types.ts`, `api.ts`, i18n `socialCreate` |
| **F3 Engage & analyse** | `community/**`, `inbox/**`, `insights/**`, i18n `socialEngage` |

Shared read-only for everyone (written by the main agent from this contract):
`lib/contract.ts`, `lib/api/*` (typed clients for EVERY endpoint above, `uploadSocialMedia()`
with progress + measured dimensions + video poster, `fieldErrors()` / `errorCode()` to read
400/422 bodies), `lib/realtime.ts` (`useSocialEvent(event, handler)`), `composer-bridge.ts`
(`openComposer(prefill)`), `router.tsx`, `config/navigation.ts`, `src/lib/api-client.ts`
(errors are now `ApiRequestError` with `status` + `body`). Need a change there → ask the main agent.

No new frontend dependencies: charts are small SVG components, drag-and-drop is native
HTML5 with a "Move to…" menu fallback for touch, the emoji picker is a curated grid.
