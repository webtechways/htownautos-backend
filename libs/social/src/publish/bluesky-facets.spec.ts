import { buildBlueskyFacets } from './bluesky-facets';

describe('buildBlueskyFacets', () => {
  it('builds a link facet with UTF-8 byte offsets', async () => {
    const text = 'Check this out: https://example.com/x';
    const facets = await buildBlueskyFacets(text, null);
    expect(facets).toHaveLength(1);
    expect(facets[0].features[0]).toEqual({ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/x' });
    const byteStart = Buffer.byteLength(text.slice(0, text.indexOf('https://')), 'utf8');
    expect(facets[0].index.byteStart).toBe(byteStart);
  });

  it('builds a hashtag facet', async () => {
    const facets = await buildBlueskyFacets('great car #htownautos today', null);
    expect(facets).toHaveLength(1);
    expect(facets[0].features[0]).toEqual({ $type: 'app.bsky.richtext.facet#tag', tag: 'htownautos' });
  });

  it('uses UTF-8 byte offsets, not UTF-16 length, for text with multibyte characters', async () => {
    // "café " is 5 UTF-16 code units but 6 UTF-8 bytes (é = 2 bytes) — a bug here would offset the tag by one byte.
    const text = 'café #deal';
    const facets = await buildBlueskyFacets(text, null);
    const expectedStart = Buffer.byteLength('café ', 'utf8');
    expect(facets[0].index.byteStart).toBe(expectedStart);
    expect(expectedStart).toBe(6);
  });

  it('resolves mentions through the injected resolver and skips unresolvable handles', async () => {
    const resolver = jest.fn(async (handle: string) => (handle === 'known.bsky.social' ? 'did:plc:abc123' : null));
    const facets = await buildBlueskyFacets('hi @known.bsky.social and @missing.bsky.social', resolver);
    expect(facets).toHaveLength(1);
    expect(facets[0].features[0]).toEqual({ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:abc123' });
  });

  it('skips mentions entirely when no resolver is given', async () => {
    const facets = await buildBlueskyFacets('hi @someone.bsky.social', null);
    expect(facets).toHaveLength(0);
  });
});
