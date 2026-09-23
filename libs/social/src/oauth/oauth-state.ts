import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { AccountType, SocialPlatform } from '../types';

/**
 * Signed OAuth `state` payload, per docs/social-suite/contract.ts.
 * Wire format: `${base64url(JSON.stringify(payload))}.${base64url(hmacSha256(body))}`.
 */
export interface OAuthStatePayload {
  platform: SocialPlatform;
  tenantId: string;
  userId: string;
  nonce: string;
  /** epoch ms */
  exp: number;
  accountType?: AccountType;
  /** mastodon only */
  instance?: string;
}

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes, per CONTRACT.md §3.1

function loadSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error('OAUTH_STATE_SECRET no está configurada');
  }
  return secret;
}

function sign(body: string): string {
  return createHmac('sha256', loadSecret()).update(body).digest('base64url');
}

/**
 * Signs a fresh OAuth state. `nonce` and `exp` are generated here — the
 * caller only supplies the identifying fields.
 */
export function signOAuthState(
  payload: Omit<OAuthStatePayload, 'nonce' | 'exp'>,
): string {
  const full: OAuthStatePayload = {
    ...payload,
    nonce: randomBytes(16).toString('hex'),
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const signature = sign(body);
  return `${body}.${signature}`;
}

/**
 * Verifies a signed OAuth state and returns its payload. Throws on a bad
 * signature, an expired state, or a tenant/user that doesn't match the
 * caller making the callback request (prevents an attacker from replaying a
 * state signed for a different tenant/user against their own OAuth flow).
 */
export function verifyOAuthState(
  state: string,
  expected: { tenantId: string; userId: string },
): OAuthStatePayload {
  if (!state || typeof state !== 'string' || !state.includes('.')) {
    throw new Error('OAuth state inválido');
  }
  const [body, signature] = state.split('.');
  if (!body || !signature) {
    throw new Error('OAuth state inválido');
  }

  const expectedSignature = sign(body);
  const a = Buffer.from(signature, 'base64url');
  const b = Buffer.from(expectedSignature, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Firma de OAuth state inválida');
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('OAuth state inválido');
  }

  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    throw new Error('OAuth state expirado');
  }
  if (payload.tenantId !== expected.tenantId || payload.userId !== expected.userId) {
    throw new Error('OAuth state no corresponde a este tenant/usuario');
  }

  return payload;
}
