import { HttpResponse, ProviderContext, ProviderError, ProviderErrorCode, ProviderReport, VehicleHistoryAdapter } from '../types';
import { cleanMessage, sleep, sniff } from '../provider-http';

const NOT_FOUND = /not found|no record|no data|report unavailable|unavailable for this vin|no report/i;

function messageOf(res: HttpResponse): string {
  return cleanMessage(res.json<{ message?: string }>()?.message ?? res.text());
}

function classify(res: HttpResponse): ProviderError {
  const msg = messageOf(res);
  const lower = msg.toLowerCase();
  if (res.status === 401 || res.status === 403) return res.fail('auth', msg || `HTTP ${res.status}`);
  if (res.status >= 500) return res.fail('upstream', msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}`);
  if (res.status === 402 || /credit|balance|insufficient/.test(lower)) return res.fail('no_credits', msg || 'Insufficient credits');
  if (res.status === 429 || lower.includes('rate limit')) return res.fail('rate_limited', msg || 'Rate limited');
  if (res.status === 400 && /vin/.test(lower)) return res.fail('invalid_vin', msg);
  if (res.status === 404 || NOT_FOUND.test(lower)) return res.fail('not_found', msg || 'Report not found');
  return res.fail('upstream', msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}`);
}

interface JobStatus {
  status?: string;
  isComplete?: boolean;
  isFailed?: boolean;
  statusMessage?: string;
  result?: { success?: boolean; report?: string; reportId?: string; reportUrl?: string; message?: string };
}

/** Decodes the job's base64 payload (optionally a data: URI) into a PDF or HTML body. */
function decodeInline(report: string | undefined): ProviderReport | null {
  if (!report || typeof report !== 'string') return null;
  const b64 = report.replace(/^data:[^;,]+;base64,/, '').trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 200))) {
    // Not base64: maybe the HTML itself.
    const body = Buffer.from(report, 'utf8');
    return sniff(body) === 'text/html' ? { body, contentType: 'text/html' } : null;
  }
  const body = Buffer.from(b64, 'base64');
  const type = sniff(body);
  return type ? { body, contentType: type } : null;
}

/** Turns a completed job into the report: inline base64 first, else the stored file. */
async function finishJob(ctx: ProviderContext, jobId: string, job: JobStatus | null): Promise<ProviderReport> {
  const result = job?.result;
  if (result?.success === false) {
    const msg = cleanMessage(result.message ?? 'Report unavailable');
    throw new ProviderError(NOT_FOUND.test(msg) ? 'not_found' : 'upstream', msg);
  }
  const inline = decodeInline(result?.report);
  if (inline) return { ...inline, providerReportId: result?.reportId ?? jobId };

  // Nothing usable inline (e.g. a JSON report): take the stored file.
  if (result?.reportId) {
    const file = await ctx.http({ kind: 'fetch', route: '/api/vhrs/:reportId/pdf', path: `/api/vhrs/${encodeURIComponent(result.reportId)}/pdf` });
    if (!file.ok) throw classify(file);
    const type = sniff(file.buffer);
    if (type) return { body: file.buffer, contentType: type, providerReportId: result.reportId };
    throw file.fail('bad_response', `Report file is ${file.contentType || 'of an unknown type'}, not PDF/HTML`);
  }
  throw new ProviderError('bad_response', `Job ${jobId} completed without a report`);
}

/**
 * globalvin.co supplier API (X-API-Key) — asynchronous: ordering queues a job
 * and the report arrives when /api/jobs/status says it's complete (base64 PDF
 * or HTML), else from /api/vhrs/:reportId/pdf.
 */
export const globalVinAdapter: VehicleHistoryAdapter = {
  key: 'globalvin',
  name: 'GlobalVIN',
  website: 'https://globalvin.co',
  envApiKey: 'GLOBALVIN_API_KEY',
  defaultBaseUrl: 'https://globalvin.co/backend',
  turnaround: '1–5 minutes (queued job, polled every 4 s)',
  defaultTimeoutMs: 300_000,
  supports: ['carfax', 'autocheck'],
  routes: [
    { method: 'GET', route: '/api/usa/report/carfax/:vin', purpose: 'Order a Carfax report (queues a job)', cost: '$3.00' },
    { method: 'GET', route: '/api/usa/report/autocheck/:vin', purpose: 'Order an AutoCheck report (queues a job)', cost: '$3.00' },
    { method: 'GET', route: '/api/jobs/status/:jobId', purpose: 'Poll the job until the report is ready', cost: 'Free' },
    { method: 'GET', route: '/api/vhrs/:reportId/pdf', purpose: 'Report file, when the job carries none inline', cost: 'Free' },
    { method: 'GET', route: '/api/credits/balance', purpose: 'Health check: credit balance', cost: 'Free' },
  ],

  async fetchReport(ctx, vin, type) {
    const headers = { 'X-API-Key': ctx.apiKey };
    const order = await ctx.http({ kind: 'report', route: `/api/usa/report/${type}/:vin`, path: `/api/usa/report/${type}/${vin}`, headers });
    if (!order.ok) throw classify(order);
    const queued = order.json<{ success?: boolean; message?: string; data?: { jobId?: string } }>();
    const jobId = queued?.data?.jobId;
    if (!jobId) throw order.fail('bad_response', cleanMessage(queued?.message ?? 'No jobId in the response'));

    let job: JobStatus | null = null;
    let transientErrors = 0;
    for (let wait = 3000; ; wait = 4000) {
      if (Date.now() + wait > ctx.deadline) {
        throw new ProviderError('timeout', `Job ${jobId} not ready in time; checking it again in the background`, null, jobId);
      }
      await sleep(wait);
      let poll: HttpResponse;
      try {
        poll = await ctx.http({ kind: 'poll', route: '/api/jobs/status/:jobId', path: `/api/jobs/status/${jobId}`, headers, timeoutMs: 20_000, collapseKey: `job:${jobId}` });
      } catch (err) {
        // A blip while polling doesn't lose the job: keep polling a few times.
        if (err instanceof ProviderError && (err.code === 'network' || err.code === 'timeout') && ++transientErrors <= 3) continue;
        throw err;
      }
      if (!poll.ok) {
        if (poll.status >= 500 && ++transientErrors <= 3) continue;
        throw classify(poll);
      }
      job = poll.json<{ data?: JobStatus }>()?.data ?? null;
      if (job?.isFailed || job?.status === 'failed') {
        const msg = cleanMessage(job.statusMessage ?? job.result?.message ?? 'Job failed');
        const code: ProviderErrorCode = NOT_FOUND.test(msg) ? 'not_found' : /credit|balance/i.test(msg) ? 'no_credits' : 'upstream';
        throw poll.fail(code, `Job ${jobId}: ${msg}`);
      }
      if (job?.isComplete || job?.status === 'completed') break;
    }

    return finishJob(ctx, jobId, job);
  },

  async resumeJob(ctx, jobId) {
    const poll = await ctx.http({ kind: 'poll', route: '/api/jobs/status/:jobId', path: `/api/jobs/status/${jobId}`, headers: { 'X-API-Key': ctx.apiKey }, timeoutMs: 20_000 });
    if (!poll.ok) throw classify(poll);
    const job = poll.json<{ data?: JobStatus }>()?.data ?? null;
    if (job?.isFailed || job?.status === 'failed') {
      const msg = cleanMessage(job.statusMessage ?? job.result?.message ?? 'Job failed');
      throw poll.fail(NOT_FOUND.test(msg) ? 'not_found' : 'upstream', `Job ${jobId}: ${msg}`);
    }
    if (!(job?.isComplete || job?.status === 'completed')) return 'pending';
    return finishJob(ctx, jobId, job);
  },

  async healthCheck(ctx) {
    const res = await ctx.http({ kind: 'health', route: '/api/credits/balance', path: '/api/credits/balance', headers: { 'X-API-Key': ctx.apiKey } });
    if (!res.ok) throw classify(res);
    const d = res.json<{ data?: { creditBalance?: number; carfaxCredits?: number } }>()?.data ?? {};
    const balance = { creditBalance: d.creditBalance ?? null, carfaxCredits: d.carfaxCredits ?? null };
    // A report costs $3 (or one bulk Carfax credit).
    if ((balance.creditBalance ?? 0) < 3 && (balance.carfaxCredits ?? 0) < 1) {
      return { status: 'degraded', message: 'Balance too low for a report', balance };
    }
    return { status: 'up', message: null, balance };
  },
};
