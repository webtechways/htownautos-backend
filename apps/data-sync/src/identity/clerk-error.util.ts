/** Outcome bucket for a Clerk API failure — decides the User row's next state. */
export type ClerkErrorCode = 'email_in_use' | 'phone_in_use' | 'user_quota_exceeded' | 'transient' | 'other';

export interface ClassifiedClerkError {
  code: ClerkErrorCode;
  message: string;
  /** Transient errors stay PENDING (retried by the sweep's ">2min" rule) instead of burning one of the 8 FAILED-backoff attempts. */
  transient: boolean;
}

interface ClerkApiErrorShape {
  status?: number;
  message?: string;
  errors?: Array<{ code?: string; message?: string; longMessage?: string; meta?: { paramName?: string } }>;
}

/**
 * Best-effort classification of a `@clerk/backend` error into the buckets
 * CLERK-SYNC-DESIGN.md names explicitly. Clerk's error codes aren't
 * exhaustively documented for every failure mode (in particular the
 * dev-instance 100-user cap), so this errs toward `transient` for anything
 * unrecognized with no HTTP status (network failure) and `other` for
 * recognized-but-unclassified 4xx — both land the User in FAILED with the
 * raw message preserved in `clerkSyncError` for staff to read.
 */
export function classifyClerkError(err: unknown): ClassifiedClerkError {
  const e = err as ClerkApiErrorShape;
  const clerkErrors = e?.errors ?? [];

  for (const item of clerkErrors) {
    if (item.code === 'form_identifier_exists' || item.code === 'identifier_already_signed_up') {
      const param = item.meta?.paramName ?? '';
      const message = item.longMessage ?? item.message ?? 'identifier already in use';
      if (param.includes('phone')) return { code: 'phone_in_use', message, transient: false };
      return { code: 'email_in_use', message, transient: false };
    }
    if (item.code && /quota/i.test(item.code)) {
      return { code: 'user_quota_exceeded', message: item.longMessage ?? item.message ?? 'Clerk user quota exceeded', transient: false };
    }
  }

  if (e?.status === 429 || (typeof e?.message === 'string' && /quota/i.test(e.message))) {
    return { code: 'user_quota_exceeded', message: e?.message ?? 'Clerk user quota exceeded', transient: false };
  }

  if (!e?.status || e.status >= 500) {
    return { code: 'transient', message: e?.message ?? 'transient Clerk error', transient: true };
  }

  return { code: 'other', message: e?.message ?? 'unknown Clerk error', transient: false };
}
