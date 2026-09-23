import { randomBytes } from 'crypto';
import type { PrismaService } from '@htownautos/prisma';

/**
 * Own tiny code generator — deliberately NOT importing `ShortUrlService`
 * (owned by `apps/api`, not importable from `libs/social`/`apps/data-sync`
 * across the Nx app boundary). Same shape (4 random bytes, base64url) so
 * codes minted here and from the api's own composer look identical.
 */
function generateCode(): string {
  return randomBytes(4).toString('base64url');
}

const SHORT_URL_BASE = () => process.env.SHORT_URL_BASE || 'https://link.htownautos.com';

export interface LinkShorteningSettings {
  shortenLinks: boolean;
  utmEnabled: boolean;
  utmSource: string | null;
  utmMedium: string;
  utmCampaign: string | null;
}

const URL_RE = /https?:\/\/[^\s]+[^\s.,;:!?)'"\]]/g;

export function extractUrls(text: string): string[] {
  const found = text.match(URL_RE) ?? [];
  return Array.from(new Set(found));
}

export function appendUtm(url: string, platform: string, settings: Pick<LinkShorteningSettings, 'utmSource' | 'utmMedium' | 'utmCampaign'>): string {
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', settings.utmSource || platform);
    u.searchParams.set('utm_medium', settings.utmMedium);
    if (settings.utmCampaign) u.searchParams.set('utm_campaign', settings.utmCampaign);
    return u.toString();
  } catch {
    return url; // malformed URL — leave it untouched rather than throwing mid-publish
  }
}

/**
 * Replaces every URL in `text` with a freshly-minted `ShortUrl` row (linked
 * to `targetId` via `socialPostTargetId`), applying UTM params first when
 * enabled. No-op when `settings.shortenLinks` is off or the text has no
 * URLs. Per CONTRACT.md §3.10 — the stored `SocialPost`/`SocialPostTarget`
 * text is never mutated; only the text actually sent to the platform is.
 */
export async function applyLinkShortening(
  prisma: PrismaService,
  tenantId: string,
  targetId: string,
  platform: string,
  text: string,
  settings: LinkShorteningSettings,
): Promise<string> {
  if (!settings.shortenLinks) return text;
  const urls = extractUrls(text);
  if (urls.length === 0) return text;

  let result = text;
  const base = SHORT_URL_BASE();
  for (const url of urls) {
    const destination = settings.utmEnabled ? appendUtm(url, platform, settings) : url;

    let code = generateCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.shortUrl.create({
          data: { code, originalUrl: destination, tenantId, socialPostTargetId: targetId },
        });
        break;
      } catch (err) {
        if (attempt === 4) throw err;
        code = generateCode(); // unique constraint collision — vanishingly rare, retry with a fresh code
      }
    }

    result = result.split(url).join(`${base}/${code}`);
  }
  return result;
}
