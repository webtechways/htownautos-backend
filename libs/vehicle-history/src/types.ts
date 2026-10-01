/** Vehicle history report types the router can order. */
export type ReportType = 'carfax' | 'autocheck';
export const REPORT_TYPES: ReportType[] = ['carfax', 'autocheck'];

export type ProviderErrorCode =
  | 'timeout'
  | 'network'
  | 'cloudflare'
  | 'auth'
  | 'no_credits'
  | 'rate_limited'
  | 'not_found'
  | 'invalid_vin'
  | 'upstream'
  | 'bad_response';

/**
 * provider: the provider itself failed (counts toward its circuit breaker);
 * vin: it works but has nothing for this VIN (the next provider may);
 * input: the request is invalid, so no other provider will do better.
 */
export type ErrorScope = 'provider' | 'vin' | 'input';

const SCOPE: Record<ProviderErrorCode, ErrorScope> = {
  timeout: 'provider',
  network: 'provider',
  cloudflare: 'provider',
  auth: 'provider',
  no_credits: 'provider',
  rate_limited: 'provider',
  upstream: 'provider',
  bad_response: 'provider',
  not_found: 'vin',
  invalid_vin: 'input',
};

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
  }

  get scope(): ErrorScope {
    return SCOPE[this.code];
  }
}

/** A finished report as a provider delivered it. */
export interface ProviderReport {
  body: Buffer;
  contentType: 'text/html' | 'application/pdf';
  yearMakeModel?: string | null;
  providerReportId?: string | null;
}

export interface HealthResult {
  status: 'up' | 'degraded' | 'down';
  message?: string | null;
  /** Credits / limits as the provider reports them (shown as-is in the UI). */
  balance?: Record<string, unknown> | null;
}

/** One HTTP call to a provider, as stored in vehicle_history_calls. */
export interface CallEntry {
  kind: 'report' | 'poll' | 'fetch' | 'health';
  reportType: ReportType | null;
  method: string;
  route: string;
  httpStatus: number | null;
  ok: boolean;
  errorCode: ProviderErrorCode | null;
  message: string | null;
  durationMs: number;
  startedAt: number;
  /** Repeated calls with the same key (job polls) are folded into one entry. */
  collapseKey?: string;
  count?: number;
}

export interface HttpRequest {
  kind: CallEntry['kind'];
  method?: 'GET' | 'POST';
  /** Template logged in place of the real path, e.g. "/api/carfax/vin/:vin/html". */
  route: string;
  /** Real path, appended to the provider's base URL. */
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Per-call timeout; never longer than what's left of the report's budget. */
  timeoutMs?: number;
  collapseKey?: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  contentType: string;
  buffer: Buffer;
  text(): string;
  json<T = Record<string, unknown>>(): T | null;
  /** Marks this call as failed in the log and returns the error to throw. */
  fail(code: ProviderErrorCode, message: string): ProviderError;
  /** Marks this call as failed in the log without throwing (e.g. before a retry). */
  mark(code: ProviderErrorCode, message: string): void;
}

export interface ProviderContext {
  apiKey: string;
  baseUrl: string;
  /** Epoch ms after which the report attempt gives up. */
  deadline: number;
  reportType: ReportType | null;
  http(req: HttpRequest): Promise<HttpResponse>;
}

export interface ProviderRoute {
  method: string;
  route: string;
  purpose: string;
  cost: string;
}

/**
 * A report provider. Adding one = a new adapter file + an entry in
 * providers/index.ts; its row (priority, toggles, key) appears automatically.
 */
export interface VehicleHistoryAdapter {
  key: string;
  name: string;
  website: string;
  /** Env var used when no key was set from the UI. */
  envApiKey: string;
  defaultBaseUrl: string;
  /** Typical wait for a report, shown in the UI. */
  turnaround: string;
  supports: ReportType[];
  routes: ProviderRoute[];
  fetchReport(ctx: ProviderContext, vin: string, type: ReportType): Promise<ProviderReport>;
  healthCheck(ctx: ProviderContext): Promise<HealthResult>;
}
