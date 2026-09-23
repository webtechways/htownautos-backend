/**
 * AT Protocol richtext facets for Bluesky posts: links, @mentions and
 * #hashtags. Byte offsets are UTF-8 (not UTF-16/`.length`, and not grapheme
 * count) per the `app.bsky.richtext.facet` spec — a pure function so it can
 * be unit-tested without a network call.
 */
export interface BlueskyFacet {
  index: { byteStart: number; byteEnd: number };
  features: Array<
    | { $type: 'app.bsky.richtext.facet#link'; uri: string }
    | { $type: 'app.bsky.richtext.facet#mention'; did: string }
    | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  >;
}

const URL_RE = /https?:\/\/[^\s]+[^\s.,;:!?)'"\]]/g;
const MENTION_RE = /(^|[\s(])@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const HASHTAG_RE = /(^|[\s(])#([^\d\s][\w]*)/g;

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * `resolveMentionDid` looks up a handle's DID (network call) — pass `null`
 * to skip mention facets entirely (e.g. from a pure unit test).
 */
export async function buildBlueskyFacets(
  text: string,
  resolveMentionDid: ((handle: string) => Promise<string | null>) | null,
): Promise<BlueskyFacet[]> {
  const facets: BlueskyFacet[] = [];

  for (const m of text.matchAll(URL_RE)) {
    const uri = m[0];
    const start = utf8ByteLength(text.slice(0, m.index));
    facets.push({ index: { byteStart: start, byteEnd: start + utf8ByteLength(uri) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] });
  }

  if (resolveMentionDid) {
    for (const m of text.matchAll(MENTION_RE)) {
      const handle = m[2];
      const did = await resolveMentionDid(handle);
      if (!did) continue;
      const prefixLen = m[1].length;
      const matchStart = m.index + prefixLen;
      const full = `@${handle}`;
      const start = utf8ByteLength(text.slice(0, matchStart));
      facets.push({ index: { byteStart: start, byteEnd: start + utf8ByteLength(full) }, features: [{ $type: 'app.bsky.richtext.facet#mention', did }] });
    }
  }

  for (const m of text.matchAll(HASHTAG_RE)) {
    const tag = m[2];
    const prefixLen = m[1].length;
    const matchStart = m.index + prefixLen;
    const full = `#${tag}`;
    const start = utf8ByteLength(text.slice(0, matchStart));
    facets.push({ index: { byteStart: start, byteEnd: start + utf8ByteLength(full) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag }] });
  }

  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}
