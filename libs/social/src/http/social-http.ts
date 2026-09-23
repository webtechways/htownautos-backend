import type { SocialPlatform } from '../types';

export type SocialApiErrorKind =
  | 'AUTH'
  | 'PERMISSION'
  | 'RATE_LIMIT'
  | 'TRANSIENT'
  | 'VALIDATION'
  | 'NOT_SUPPORTED'
  | 'NOT_CONFIGURED'
  | 'UNKNOWN';

export interface SocialApiErrorInput {
  platform: SocialPlatform;
  /** 0 when the failure never reached the platform (timeout, DNS, abort). */
  httpStatus: number;
  kind: SocialApiErrorKind;
  retryAfterSec?: number;
  message: string;
}

/**
 * Uniform error shape for every platform call in the Social Suite. Never
 * include the access token, refresh token, or any Authorization header value
 * in `message` — these bubble up into notifications and, eventually, into
 * whatever the composer shows the user.
 */
export class SocialApiError extends Error {
  readonly platform: SocialPlatform;
  readonly httpStatus: number;
  readonly kind: SocialApiErrorKind;
  readonly retryAfterSec?: number;

  constructor(input: SocialApiErrorInput) {
    super(input.message);
    this.name = 'SocialApiError';
    this.platform = input.platform;
    this.httpStatus = input.httpStatus;
    this.kind = input.kind;
    this.retryAfterSec = input.retryAfterSec;
  }

  /** Whether the publisher/poller should retry this call (with backoff). */
  isTransient(): boolean {
    return this.kind === 'TRANSIENT' || this.kind === 'RATE_LIMIT';
  }
}

export interface SocialFetchOptions extends Omit<RequestInit, 'signal'> {
  platform: SocialPlatform;
  /** default 15s */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

function classifyStatus(status: number): SocialApiErrorKind {
  if (status === 401) return 'AUTH';
  if (status === 403) return 'PERMISSION';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'TRANSIENT';
  if (status === 400 || status === 404 || status === 422) return 'VALIDATION';
  return 'UNKNOWN';
}

/**
 * `fetch` wrapper shared by every platform client: enforces a timeout,
 * raises {@link SocialApiError} on a non-2xx response, and folds network
 * failures/aborts into the same error shape so callers only ever handle one
 * exception type.
 */
export async function socialFetch(url: string, options: SocialFetchOptions): Promise<Response> {
  const { platform, timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const retryAfterHeader = res.headers.get('retry-after');
      throw new SocialApiError({
        platform,
        httpStatus: res.status,
        kind: classifyStatus(res.status),
        retryAfterSec: retryAfterHeader ? Number(retryAfterHeader) || undefined : undefined,
        message: `${platform} respondió ${res.status} ${res.statusText}`.trim(),
      });
    }
    return res;
  } catch (err) {
    if (err instanceof SocialApiError) throw err;
    if ((err as { name?: string }).name === 'AbortError') {
      throw new SocialApiError({
        platform,
        httpStatus: 0,
        kind: 'TRANSIENT',
        message: `Tiempo de espera agotado al llamar a ${platform}`,
      });
    }
    throw new SocialApiError({
      platform,
      httpStatus: 0,
      kind: 'TRANSIENT',
      message: `Error de red llamando a ${platform}: ${(err as Error).message}`,
    });
  } finally {
    clearTimeout(timer);
  }
}
