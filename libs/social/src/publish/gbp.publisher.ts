import { socialFetch, SocialApiError } from '../http/social-http';
import type { PublishContext, PublishResult, SocialPublisher } from './types';
import { mediaFor } from './types';

/** `localPosts` still lives on the legacy My Business API v4 — the newer Business Information API (v1) doesn't cover posts yet. */
const BASE = 'https://mybusiness.googleapis.com/v4';

function toGbpDate(iso: string): { date: { year: number; month: number; day: number }; time: { hours: number; minutes: number; seconds: number; nanos: number } } {
  const d = new Date(iso);
  return {
    date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
    time: { hours: d.getUTCHours(), minutes: d.getUTCMinutes(), seconds: d.getUTCSeconds(), nanos: 0 },
  };
}

export const gbpPublisher: SocialPublisher = {
  async publish(ctx) {
    const opts = ctx.options.gbp;
    if (!opts) throw new SocialApiError({ platform: 'gbp', httpStatus: 0, kind: 'VALIDATION', message: 'Google Business Profile requiere el tipo de publicación (topicType)' });

    const parent = ctx.account.platformAccountId; // "accounts/{a}/locations/{l}"
    const body: Record<string, unknown> = {
      languageCode: 'en-US',
      summary: ctx.content,
      topicType: opts.topicType,
    };

    if (opts.ctaType) {
      body.callToAction = { actionType: opts.ctaType, ...(opts.ctaUrl ? { url: opts.ctaUrl } : {}) };
    }

    if (opts.topicType === 'EVENT' || opts.topicType === 'OFFER') {
      if (!opts.event) throw new SocialApiError({ platform: 'gbp', httpStatus: 0, kind: 'VALIDATION', message: `${opts.topicType} requiere event.title/startAt/endAt` });
      const start = toGbpDate(opts.event.startAt);
      const end = toGbpDate(opts.event.endAt);
      body.event = {
        title: opts.event.title,
        schedule: { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time },
      };
    }

    if (opts.topicType === 'OFFER' && opts.offer) {
      body.offer = {
        ...(opts.offer.couponCode ? { couponCode: opts.offer.couponCode } : {}),
        ...(opts.offer.redeemUrl ? { redeemOnlineUrl: opts.offer.redeemUrl } : {}),
        ...(opts.offer.terms ? { termsConditions: opts.offer.terms } : {}),
      };
    }

    const media = mediaFor(ctx, ctx.mediaIds);
    if (media.length > 0) {
      const url = await ctx.resolver.signedUrl(media[0]);
      body.media = [{ mediaFormat: 'PHOTO', sourceUrl: url }];
    }

    const res = await socialFetch(`${BASE}/${parent}/localPosts`, {
      platform: 'gbp',
      method: 'POST',
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { name: string; searchUrl?: string };
    return { externalId: data.name, externalUrl: data.searchUrl ?? null };
  },
};
