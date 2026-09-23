---
name: social-suite-b4b-patterns
description: Patterns from building the Social Suite's organize package (B4b) — tags/templates/hashtag groups/idea board/RSS-Atom feeds/AI assistant. SSRF guard, feed parser, api<->data-sync duplication call, OpenAI JSON-mode compose pattern.
metadata:
  type: project
---

Context: htownautos-backend `feat/social-suite`, package B4b (`apps/api/src/social/organize/**` + `apps/data-sync/src/social/planning-jobs/**`). See [[other-memory-location]] for B1-B3 notes at the repo-root memory dir.

## No SSRF helper existed anywhere in the repo — wrote one from scratch
Checked `grep -rln "isPrivateIp|ssrf" apps libs` first (per the task brief) — zero hits. Wrote `feeds/ssrf-guard.ts`: `assertPublicHttpUrl(rawUrl)` does `new URL()` + protocol check (http/https only) + `dns.promises.lookup(hostname, {all:true})` + a private/reserved IPv4+IPv6 range table (manual, no new dep — `ipaddr.js` etc. would have been "something else new", brief only allowed `fast-xml-parser`). `fetchPublicUrl(url)` then fetches with `redirect: 'error'` (refuses to follow redirects) specifically so a validated URL can't be redirected server-side into a private address after the DNS check already passed — re-validating every redirect hop was judged out of scope for a "small" guard. 5s timeout via `AbortController`+`setTimeout` (same pattern as `libs/social/src/http/social-http.ts`'s `socialFetch`), 2MB cap via manual `reader.read()` loop with a running byte counter (aborts + cancels the reader over the cap, no dependency on `content-length` since it can be absent/wrong).

## Nx apps don't import each other — duplicated the feed-sync trio verbatim
`apps/api/src/social/organize/feeds/{ssrf-guard,feed-parser,feed-sync}.ts` and `apps/data-sync/src/social/planning-jobs/feeds/{ssrf-guard,feed-parser,feed-sync}.ts` are byte-identical copies. Considered putting shared logic in `libs/social/src/organize/` but the brief's ownership boundary only granted `apps/api/src/social/organize/**` and the data-sync `planning-jobs/` folder, not `libs/social` (frozen/owned by B1-B3, other agents may be editing it in parallel) — duplication of ~180 lines of self-contained utility code was judged safer than reaching into a shared lib outside scope. If a future package needs the same SSRF guard, promoting it to `libs/social` and deleting one copy is the move, not before.

## `fast-xml-parser` output shape gotchas (v5.11.1, installed via this package)
- Single child element vs repeated siblings: `<item>` appears once → parser gives an object; appears 2+ times → an array. Always normalize with a `toArray()` helper before `.map()`.
- A tag with BOTH attributes and text content (e.g. `<guid isPermaLink="false">post-2</guid>` with `ignoreAttributes:false`) parses to `{ '@_isPermaLink': 'false', '#text': 'post-2' }`, not a bare string. A tag with only text stays a bare string. Need a `text()` helper that branches on `typeof value === 'string'` vs `'#text' in value`.
- `processEntities` defaults true, so `&lt;p&gt;` in RSS `<description>` decodes to `<p>` automatically — don't double-decode.
- No schema validation by default — garbage XML doesn't throw from `parser.parse()`, it just returns something that doesn't have `.rss.channel` or `.feed`. The "is this actually RSS/Atom" gate has to be an explicit shape check after parsing, not a try/catch around `parse()` alone (both paths funnel into the same `BadRequestException` though, so callers don't need to care which one fired).

## OpenAI JSON-mode pattern for `/social/ai/*` (new precedent — `ai-chat`/`ai-translate` didn't use it)
`ai.service.ts#callJson(system, user)` uses `response_format: { type: 'json_object' }` + a system prompt that demands "Respond with ONLY a JSON object: {...}. No preamble, no markdown fences." then `JSON.parse()`s the single message content. Cheaper than a second round-trip for "give me N alternatives" (asks for `text` + up to 2 `alternatives` in one call) and avoids the ai-chat pattern's tool-calling loop (`MAX_VUELTAS`) which is overkill for a single compose/translate/suggest call with no external data lookups needed. Model resolution: `SOCIAL_AI_MODEL || AI_CHAT_MODEL || 'gpt-4o-mini'` per contract.ts. Same `OPENAI_API_KEY || TTS_API_KEY` fallback as `ai-chat`/`ai-translate` (prod key is stored as `TTS_API_KEY`) — constructed as `OpenAI | null` in the constructor (warn, don't throw) so a missing key never crash-loops the API, only fails the endpoint at call time.

## `PrismaService` already had every getter this package needed
`socialTag`, `socialTemplate`, `socialHashtagGroup`, `socialIdeaGroup`, `socialIdea`, `socialFeed`, `socialFeedItem`, `inboxConversation`, `inboxMessage`, `socialComment` were all already present in `libs/prisma/src/prisma.service.ts` before this package started (added by whichever B1-B3 package touched schema/prisma.service.ts first) — confirmed via grep before writing any service, no wrapper edits needed. If a TS2551 "Did you mean X?" shows up on a Social Suite model, check that file first (see [[other-memory-location]]'s pointer to the wrapper-pattern note).

## Reused `resolveMediaMap`/`toUserSummary` from `posts/mappers.ts` across the folder boundary
`apps/api/src/social/organize/idea-view.ts` imports both from `../posts/mappers` instead of reimplementing — same-app cross-folder import is fine (unlike the api↔data-sync case above, this isn't crossing an Nx app boundary). `SocialIdea.mediaIds` is a plain `String[]` scalar column (not a relation), so the view builder does `mediaIds.map(id => mediaMap.get(id)).filter(Boolean)` to get `media` in the same order as `mediaIds`.
