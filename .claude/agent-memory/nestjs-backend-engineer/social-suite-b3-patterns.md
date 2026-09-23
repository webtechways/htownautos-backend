---
name: social-suite-b3-patterns
description: Patterns from building the Social Suite's publish/publisher package (B3) — Buffer-vs-BodyInit TS strictness, Google resumable-upload 308s, FOR UPDATE SKIP LOCKED claim pattern, multi-platform publisher interface design
metadata:
  type: project
---

Context: htownautos-backend `feat/social-suite`, package B3 (`libs/social/src/publish/**` + `apps/data-sync/src/social/publisher/**`) — 11 platform publishers (Facebook/Instagram/Threads/X/LinkedIn/TikTok/YouTube/Pinterest/Bluesky/Mastodon/GBP) + the claim/backoff/status worker. See [[social-suite-b2-patterns]] for the foundation this builds on.

## Node `Buffer` is not a DOM `BodyInit`/`BlobPart` under strict TS
Passing a `Buffer` directly as `fetch(url, { body: buf })` or `new Blob([buf])` fails to typecheck (not at runtime — Node's fetch/Blob accept Buffer fine): `Buffer.buffer` is typed `ArrayBufferLike` (includes `SharedArrayBuffer`), which newer `lib.dom.d.ts` `ArrayBufferView<ArrayBuffer>` rejects. `new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength)` alone still infers `Uint8Array<ArrayBufferLike>` (constructor overload resolution doesn't narrow from the cast argument) — you also need an explicit return-type annotation + cast on the *construction result*:
```ts
export function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as Uint8Array<ArrayBuffer>;
}
```
Wrote this once in `libs/social/src/publish/bytes.ts`, used everywhere a Buffer becomes a fetch body or Blob part (X/Bluesky/Mastodon/Pinterest/TikTok/LinkedIn/YouTube publishers). Cheaper than converting every call site's types.

## Google's resumable upload protocol returns 308 for intermediate chunks — don't run it through `socialFetch`
`socialFetch` (`libs/social/src/http/social-http.ts`) treats any non-2xx as `SocialApiError`. Google's resumable upload (YouTube `videos.insert?uploadType=resumable`) intentionally answers every non-final PUT chunk with `308 Resume Incomplete` — that's success, not an error. Chunked PUTs against a Google resumable session URL must go through plain `fetch` with manual status handling (`if (res.status === 308) continue;`), not `socialFetch`. Same caution applies to any other protocol that uses non-2xx as a normal "continue" signal (TikTok/LinkedIn/X chunked uploads use 2xx per-chunk so `socialFetch` is fine there).

## `FOR UPDATE SKIP LOCKED` claim pattern (first raw-SQL locking in this repo)
No prior precedent for row-locking raw SQL existed (checked before writing — nothing in api or data-sync used `$queryRaw`+`FOR UPDATE`). Pattern used in `apps/data-sync/src/social/publisher/claim.service.ts`:
```ts
await this.prisma.$transaction(async (tx) => {
  const rows = await tx.$queryRaw<{id:string}[]>`SELECT t.id FROM ... WHERE ... FOR UPDATE OF t SKIP LOCKED`;
  if (rows.length === 0) return [];
  await tx.socialPostTarget.updateMany({ where: { id: { in: rows.map(r=>r.id) } }, data: { status: 'publishing', lockedAt: new Date() } });
  return rows.map(r=>r.id);
});
```
Must specify `FOR UPDATE OF t` (not bare `FOR UPDATE`) when the query joins other tables, or Postgres tries to lock rows in the joined tables too. Prisma camelCase columns need double-quoting in raw SQL (`t."scheduledAt"`, `a."publishMethod"`) — they're not snake_case in this DB.

## Multi-item "thread" chains need both root AND immediate parent, not just parent
Designed `SocialPublisher.publishThreadItem(ctx, chain: {root, parent}, item, index)` (own interface, not part of the frozen `docs/social-suite/contract.ts`) instead of a single `parentExternalId` string. AT-Proto (Bluesky) reply refs require `{root, parent}` both as `{uri,cid}` pairs — a single "previous item" string can't express that. X/Threads/Mastodon only use `chain.parent` and ignore `chain.root`. For platforms whose real id isn't a bare string (Bluesky needs uri+cid), encode both into `PublishResult.externalId` as a joined string (`` `${uri}|${cid}` ``) and decode on the next call — simpler than widening the whole interface's `externalId: string` to a union type across 11 platforms for one outlier.

## Extending `PublishContext` for cross-cutting needs the frozen `MediaResolverService` doesn't cover
Two needs came up that `media/media-resolver.service.ts` (frozen, B2-owned) doesn't provide: (1) Instagram image containers need a fetchable URL, but a non-JPEG source needs re-encoding first (`resolver.toJpeg` returns bytes, not a URL); (2) Mastodon needs the per-account instance hostname, which lives in `encryptedSecrets`, not on the `SocialAccount` row. Solution: don't touch the frozen file — add fields to your OWN context type instead. `PublishContext.reuploadTemp(buffer, ext, contentType) => Promise<string>` (implemented by the runner, which has `S3Service`, uploading to a throwaway `social/tmp/<tenantId>/...` key in the same private bucket) and `PublishContext.secrets: SocialAccountSecrets` (the full decrypted blob, fetched once via `SocialTokenService.getSecrets`) cover both without modifying anything outside your own package.

## Jest path patterns: this repo's publisher dir is `publisher/`, not `publish/`
`libs/social/src/publish/**` (the lib, no trailing r) vs `apps/data-sync/src/social/publisher/**` (the app's job, WITH the r) — easy to typo a `npx jest` path regex expecting one to match the other. Run them as two separate patterns or `publish(er)?/` if you want one command for both.
