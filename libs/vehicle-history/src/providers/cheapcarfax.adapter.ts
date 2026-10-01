import { HttpResponse, ProviderError, VehicleHistoryAdapter } from '../types';
import { cleanMessage, sleep } from '../provider-http';

// Browser-like headers so CheapCarfax's Cloudflare doesn't challenge our
// server-to-server (datacenter IP) requests as a bot.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://panel.cheapcarfax.net/',
};

/** A Cloudflare challenge page instead of the JSON we asked for. */
function isCloudflareBlock(res: HttpResponse): boolean {
  const head = res.text().slice(0, 400);
  return res.contentType.includes('text/html') || /^\s*<(?:!doctype|html)/i.test(head) || /cloudflare|attention required|cf-ray/i.test(head);
}

/**
 * Their errors come back as { message } and don't always use the matching
 * status: "Insufficient credits", "daily limit" and "Report not found" are all 400.
 */
function classify(res: HttpResponse): ProviderError {
  const msg = cleanMessage(res.json<{ message?: string }>()?.message ?? res.text());
  const lower = msg.toLowerCase();
  if (res.status === 401 || res.status === 403) return res.fail('auth', msg || 'Unauthorized');
  if (res.status >= 500) return res.fail('upstream', msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}`);
  if (res.status === 402 || lower.includes('credit')) return res.fail('no_credits', msg || 'Insufficient credits');
  if (res.status === 429 || lower.includes('limit')) return res.fail('rate_limited', msg || 'Daily limit reached');
  if (/not found|no record|report unavailable/.test(lower)) return res.fail('not_found', msg || 'Report not found');
  if (/vin (must|is required)|invalid vin/.test(lower)) return res.fail('invalid_vin', msg);
  return res.fail('upstream', msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}`);
}

/** docs.cheapcarfax.net — synchronous: the report HTML comes back in the same call. */
export const cheapCarfaxAdapter: VehicleHistoryAdapter = {
  key: 'cheapcarfax',
  name: 'CheapCarfax',
  website: 'https://panel.cheapcarfax.net',
  envApiKey: 'CARFAX_API',
  defaultBaseUrl: 'https://panel.cheapcarfax.net',
  turnaround: 'Seconds (synchronous)',
  supports: ['carfax', 'autocheck'],
  routes: [
    { method: 'GET', route: '/api/carfax/vin/:vin/html', purpose: 'Carfax report (HTML)', cost: '1 credit' },
    { method: 'GET', route: '/api/autocheck/vin/:vin/html', purpose: 'AutoCheck report (HTML)', cost: '1 credit' },
    { method: 'GET', route: '/api/user/limits', purpose: 'Health check: credits and daily limits', cost: 'Free' },
  ],

  async fetchReport(ctx, vin, type) {
    const headers = { 'x-api-key': ctx.apiKey, ...BROWSER_HEADERS };
    // Cloudflare sometimes challenges our egress IP for a moment: retry a couple of times.
    for (let attempt = 1; ; attempt++) {
      const res = await ctx.http({ kind: 'report', route: `/api/${type}/vin/:vin/html`, path: `/api/${type}/vin/${vin}/html`, headers });
      if (isCloudflareBlock(res)) {
        const msg = `Cloudflare challenge (HTTP ${res.status})`;
        if (attempt < 3 && ctx.deadline - Date.now() > 10_000) {
          res.mark('cloudflare', `${msg}, retrying`);
          await sleep(1500 * attempt);
          continue;
        }
        throw res.fail('cloudflare', msg);
      }
      if (!res.ok) throw classify(res);
      const body = res.json<{ yearMakeModel?: string; id?: string; html?: string }>();
      if (!body?.html) throw res.fail('bad_response', 'Response has no report HTML');
      return {
        body: Buffer.from(body.html, 'utf8'),
        contentType: 'text/html',
        yearMakeModel: body.yearMakeModel ?? null,
        providerReportId: body.id ?? null,
      };
    }
  },

  async healthCheck(ctx) {
    const res = await ctx.http({ kind: 'health', route: '/api/user/limits', path: '/api/user/limits', headers: { 'x-api-key': ctx.apiKey, ...BROWSER_HEADERS } });
    if (isCloudflareBlock(res)) throw res.fail('cloudflare', `Cloudflare challenge (HTTP ${res.status})`);
    if (!res.ok) throw classify(res);
    const j = res.json<Record<string, number | null>>() ?? {};
    const balance = {
      credits: j.credits ?? null,
      dailyLimit: j.daily_limit ?? null,
      carfaxLeftToday: j.carfax_reports_left_today ?? null,
      autocheckLeftToday: j.autocheck_reports_left_today ?? null,
    };
    if (balance.credits === 0) return { status: 'degraded', message: 'No credits left', balance };
    if (balance.carfaxLeftToday === 0 && balance.autocheckLeftToday === 0) return { status: 'degraded', message: 'Daily limit reached', balance };
    return { status: 'up', message: null, balance };
  },
};
