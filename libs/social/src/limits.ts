import type { PublishablePlatform } from './types';

/** Per-platform composer/publish rules. Verbatim copy of contract.ts `PlatformLimits`. */
export interface PlatformLimits {
  label: string;
  /** Main text limit (caption / description / post body). */
  maxChars: number;
  /** x-weighted = X's weighted count (URLs = 23, CJK = 2). graphemes = Bluesky. */
  countMode: 'chars' | 'graphemes' | 'x-weighted';
  titleMaxChars: number | null;
  maxImages: number;
  maxVideos: number;
  maxDocuments: number;
  /** true = images and videos can be mixed in one post (carousels). */
  allowsMixedMedia: boolean;
  requiresMedia: boolean;
  requiresVideo: boolean;
  supportsThread: boolean;
  supportsFirstComment: boolean;
  maxHashtags: number | null;
}

/** Verbatim copy of contract.ts `PLATFORM_LIMITS` — keep both in sync. */
export const PLATFORM_LIMITS: Record<PublishablePlatform, PlatformLimits> = {
  facebook: { label: 'Facebook', maxChars: 63206, countMode: 'chars', titleMaxChars: null, maxImages: 10, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: false, supportsFirstComment: true, maxHashtags: null },
  instagram: { label: 'Instagram', maxChars: 2200, countMode: 'chars', titleMaxChars: null, maxImages: 10, maxVideos: 10, maxDocuments: 0, allowsMixedMedia: true, requiresMedia: true, requiresVideo: false, supportsThread: false, supportsFirstComment: true, maxHashtags: 30 },
  threads: { label: 'Threads', maxChars: 500, countMode: 'chars', titleMaxChars: null, maxImages: 20, maxVideos: 20, maxDocuments: 0, allowsMixedMedia: true, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: 1 },
  x: { label: 'X', maxChars: 280, countMode: 'x-weighted', titleMaxChars: null, maxImages: 4, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: null },
  linkedin: { label: 'LinkedIn', maxChars: 3000, countMode: 'chars', titleMaxChars: null, maxImages: 20, maxVideos: 1, maxDocuments: 1, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: false, supportsFirstComment: true, maxHashtags: null },
  tiktok: { label: 'TikTok', maxChars: 2200, countMode: 'chars', titleMaxChars: 90, maxImages: 35, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: true, requiresVideo: false, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
  youtube: { label: 'YouTube', maxChars: 5000, countMode: 'chars', titleMaxChars: 100, maxImages: 0, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: true, requiresVideo: true, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
  pinterest: { label: 'Pinterest', maxChars: 500, countMode: 'chars', titleMaxChars: 100, maxImages: 5, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: true, requiresVideo: false, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
  bluesky: { label: 'Bluesky', maxChars: 300, countMode: 'graphemes', titleMaxChars: null, maxImages: 4, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: null },
  mastodon: { label: 'Mastodon', maxChars: 500, countMode: 'chars', titleMaxChars: null, maxImages: 4, maxVideos: 1, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: true, supportsFirstComment: false, maxHashtags: null },
  gbp: { label: 'Google Business', maxChars: 1500, countMode: 'chars', titleMaxChars: null, maxImages: 1, maxVideos: 0, maxDocuments: 0, allowsMixedMedia: false, requiresMedia: false, requiresVideo: false, supportsThread: false, supportsFirstComment: false, maxHashtags: null },
};

// CJK + other "wide" Unicode blocks that X counts as 2 chars instead of 1.
// Not exhaustive (X's real algorithm lives in twitter-text) but covers the
// common ranges: CJK unified ideographs, hiragana/katakana, hangul, fullwidth forms.
const WIDE_CHAR_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals, Kangxi, CJK Symbols/Punctuation
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6],
];

function isWideCodePoint(codePoint: number): boolean {
  return WIDE_CHAR_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

// Any http(s):// URL — X collapses every URL to a fixed 23-char weight regardless of length.
const URL_RE = /https?:\/\/\S+/g;
const X_URL_WEIGHT = 23;

function countGraphemes(text: string): number {
  const SegmenterCtor = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor('en', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].length;
  }
  // Fallback: count Unicode code points (splits fewer emoji correctly than
  // UTF-16 .length, but not perfect for combined grapheme clusters).
  return Array.from(text).length;
}

function countXWeighted(text: string): number {
  let weight = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    weight += X_URL_WEIGHT;
    return '';
  });
  for (const ch of withoutUrls) {
    weight += isWideCodePoint(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return weight;
}

/**
 * Counts `text` under the given mode. Used by the composer's live character
 * counter and by server-side validation before a post is accepted.
 */
export function countChars(text: string, mode: PlatformLimits['countMode']): number {
  if (!text) return 0;
  switch (mode) {
    case 'graphemes':
      return countGraphemes(text);
    case 'x-weighted':
      return countXWeighted(text);
    case 'chars':
    default:
      return Array.from(text).length;
  }
}
