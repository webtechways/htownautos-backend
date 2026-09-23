import { BadRequestException } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';

export interface ParsedFeedItem {
  guid: string;
  title: string;
  link: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
}

export interface ParsedFeed {
  title: string | null;
  siteUrl: string | null;
  items: ParsedFeedItem[];
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, textNodeName: '#text' });

/** Parses RSS 2.0 (`<rss><channel>`) or Atom (`<feed>`) XML into a common shape. */
export function parseFeed(xml: string): ParsedFeed {
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    throw new BadRequestException('No se pudo interpretar el XML del feed');
  }

  const root = doc as Record<string, unknown>;
  if (isObject(root.rss) && isObject((root.rss as Record<string, unknown>).channel)) {
    return parseRss((root.rss as Record<string, unknown>).channel as Record<string, unknown>);
  }
  if (isObject(root.feed)) return parseAtom(root.feed as Record<string, unknown>);
  throw new BadRequestException('El contenido no es un feed RSS 2.0 ni Atom valido');
}

function parseRss(channel: Record<string, unknown>): ParsedFeed {
  const items = toArray(channel.item).map((raw): ParsedFeedItem => {
    const item = raw as Record<string, unknown>;
    const link = text(item.link);
    const guid = text(item.guid) || link;
    return {
      guid,
      title: text(item.title) || '(sin titulo)',
      link,
      summary: text(item.description) || null,
      imageUrl: rssImage(item),
      publishedAt: parseDate(text(item.pubDate)),
    };
  });

  return { title: text(channel.title) || null, siteUrl: text(channel.link) || null, items: items.filter((i) => i.guid && i.link) };
}

function rssImage(item: Record<string, unknown>): string | null {
  const enclosure = item.enclosure as Record<string, unknown> | undefined;
  if (isObject(enclosure)) {
    const type = String(enclosure['@_type'] ?? '');
    const url = String(enclosure['@_url'] ?? '');
    if (url && type.startsWith('image/')) return url;
  }
  const mediaContent = item['media:content'] as Record<string, unknown> | undefined;
  if (isObject(mediaContent) && mediaContent['@_url']) return String(mediaContent['@_url']);
  const mediaThumbnail = item['media:thumbnail'] as Record<string, unknown> | undefined;
  if (isObject(mediaThumbnail) && mediaThumbnail['@_url']) return String(mediaThumbnail['@_url']);
  return null;
}

function parseAtom(feed: Record<string, unknown>): ParsedFeed {
  const items = toArray(feed.entry).map((raw): ParsedFeedItem => {
    const entry = raw as Record<string, unknown>;
    const link = atomLink(entry.link);
    const guid = text(entry.id) || link;
    const summary = text(entry.summary) || text(entry.content) || null;
    const published = text(entry.published) || text(entry.updated);
    return {
      guid,
      title: text(entry.title) || '(sin titulo)',
      link,
      summary,
      imageUrl: null,
      publishedAt: parseDate(published),
    };
  });

  return { title: text(feed.title) || null, siteUrl: atomLink(feed.link) || null, items: items.filter((i) => i.guid && i.link) };
}

function atomLink(link: unknown): string {
  const links = toArray(link) as Record<string, unknown>[];
  if (links.length === 0) return '';
  const alternate = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
  return String((alternate ?? links[0])['@_href'] ?? '');
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** fast-xml-parser gives plain strings for text-only nodes, `{ '#text': ... }` when the node also has attributes. */
function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (isObject(value) && '#text' in value) return String((value as Record<string, unknown>)['#text']);
  return '';
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
