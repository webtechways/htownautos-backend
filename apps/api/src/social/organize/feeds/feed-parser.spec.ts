import { BadRequestException } from '@nestjs/common';
import { parseFeed } from './feed-parser';

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Houston Auto News</title>
    <link>https://example.com</link>
    <description>Cars, cars, cars</description>
    <item>
      <title>2026 trucks to watch</title>
      <link>https://example.com/posts/1</link>
      <guid>https://example.com/posts/1</guid>
      <description>&lt;p&gt;A roundup&lt;/p&gt;</description>
      <pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate>
      <enclosure url="https://example.com/img1.jpg" type="image/jpeg" length="12345" />
    </item>
    <item>
      <title>Used SUVs on sale</title>
      <link>https://example.com/posts/2</link>
      <guid isPermaLink="false">post-2</guid>
      <pubDate>Wed, 02 Sep 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Houston Auto Atom Feed</title>
  <link href="https://example.com" rel="alternate" />
  <link href="https://example.com/feed.atom" rel="self" />
  <entry>
    <title>Financing tips</title>
    <id>urn:uuid:entry-1</id>
    <link href="https://example.com/entries/1" rel="alternate" />
    <summary>Get approved fast</summary>
    <published>2026-09-01T12:00:00Z</published>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses an RSS 2.0 feed', () => {
    const result = parseFeed(RSS_FIXTURE);
    expect(result.title).toBe('Houston Auto News');
    expect(result.siteUrl).toBe('https://example.com');
    expect(result.items).toHaveLength(2);

    expect(result.items[0]).toMatchObject({
      guid: 'https://example.com/posts/1',
      title: '2026 trucks to watch',
      link: 'https://example.com/posts/1',
      summary: '<p>A roundup</p>',
      imageUrl: 'https://example.com/img1.jpg',
    });
    expect(result.items[0].publishedAt?.toISOString()).toBe('2026-09-01T12:00:00.000Z');

    expect(result.items[1]).toMatchObject({ guid: 'post-2', title: 'Used SUVs on sale', imageUrl: null });
  });

  it('parses an Atom feed', () => {
    const result = parseFeed(ATOM_FIXTURE);
    expect(result.title).toBe('Houston Auto Atom Feed');
    expect(result.siteUrl).toBe('https://example.com');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      guid: 'urn:uuid:entry-1',
      title: 'Financing tips',
      link: 'https://example.com/entries/1',
      summary: 'Get approved fast',
    });
    expect(result.items[0].publishedAt?.toISOString()).toBe('2026-09-01T12:00:00.000Z');
  });

  it('rejects XML that is neither RSS nor Atom', () => {
    expect(() => parseFeed('<html><body>not a feed</body></html>')).toThrow(BadRequestException);
  });

  it('rejects garbage input', () => {
    expect(() => parseFeed('this is not xml at all {{{')).toThrow(BadRequestException);
  });
});
