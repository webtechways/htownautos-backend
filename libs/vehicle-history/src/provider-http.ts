import { CallEntry, HttpRequest, HttpResponse, ProviderContext, ProviderError, ReportType } from './types';

/** Longest a single HTTP call may take, whatever the report's remaining budget. */
const MAX_CALL_MS = 60_000;

/**
 * Builds the context an adapter works with: an HTTP helper that times every
 * call, records it in `calls` (later saved to vehicle_history_calls) and turns
 * network failures and timeouts into ProviderErrors.
 */
export function createContext(opts: {
  apiKey: string;
  baseUrl: string;
  deadline: number;
  reportType: ReportType | null;
  calls: CallEntry[];
}): ProviderContext {
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function http(req: HttpRequest): Promise<HttpResponse> {
    const method = req.method ?? 'GET';
    const remaining = opts.deadline - Date.now();
    if (remaining <= 0) throw new ProviderError('timeout', 'Time budget used up');
    const timeout = Math.max(1000, Math.min(req.timeoutMs ?? MAX_CALL_MS, MAX_CALL_MS, remaining));

    const started = Date.now();
    const entry: CallEntry = {
      kind: req.kind,
      reportType: opts.reportType,
      method,
      route: req.route,
      httpStatus: null,
      ok: false,
      errorCode: null,
      message: null,
      durationMs: 0,
      startedAt: started,
      collapseKey: req.collapseKey,
      count: 1,
    };
    // Job polls fold into the previous entry for the same job: one row, with a
    // count; its duration is the sum of the calls (not the wait between them).
    const prev = opts.calls[opts.calls.length - 1];
    let earlierMs = 0;
    if (req.collapseKey && prev?.collapseKey === req.collapseKey) {
      entry.startedAt = prev.startedAt;
      entry.count = (prev.count ?? 1) + 1;
      earlierMs = prev.durationMs;
      opts.calls[opts.calls.length - 1] = entry;
    } else {
      opts.calls.push(entry);
    }
    const finish = () => {
      entry.durationMs = earlierMs + (Date.now() - started);
    };

    let res: Response;
    try {
      res = await fetch(base + req.path, {
        method,
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...req.headers,
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
    } catch (err) {
      finish();
      const isTimeout = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
      entry.errorCode = isTimeout ? 'timeout' : 'network';
      entry.message = isTimeout ? `No response in ${Math.round(timeout / 1000)} s` : String((err as Error)?.message ?? err).slice(0, 300);
      throw new ProviderError(entry.errorCode, entry.message);
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      finish();
      entry.httpStatus = res.status;
      entry.errorCode = 'network';
      entry.message = `Body cut off: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
      throw new ProviderError('network', entry.message, res.status);
    }
    finish();
    entry.httpStatus = res.status;
    entry.ok = res.ok;
    if (entry.count && entry.count > 1) entry.message = `${entry.count} calls over ${Math.round((Date.now() - entry.startedAt) / 1000)} s`;

    let textCache: string | null = null;
    const text = () => (textCache ??= buffer.toString('utf8'));
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type') ?? '',
      buffer,
      text,
      json<T>() {
        try {
          return JSON.parse(text()) as T;
        } catch {
          return null;
        }
      },
      mark(code, message) {
        entry.ok = false;
        entry.errorCode = code;
        entry.message = message.slice(0, 500);
      },
      fail(code, message) {
        this.mark(code, message);
        return new ProviderError(code, message, res.status);
      },
    };
  }

  return { apiKey: opts.apiKey, baseUrl: base, deadline: opts.deadline, reportType: opts.reportType, http };
}

/** Short, single-line version of a provider message (never a whole HTML page). */
export function cleanMessage(raw: string, max = 200): string {
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** What a report body is, by its first bytes. */
export function sniff(body: Buffer): 'application/pdf' | 'text/html' | null {
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  const head = body.subarray(0, 512).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) return 'text/html';
  return null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
