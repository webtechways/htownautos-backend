/**
 * `signOAuthState` (owned by B1, `libs/social/src/oauth/oauth-state.ts`)
 * generates the `nonce` internally and only returns the signed string. The
 * X (PKCE) and Mastodon (dynamic app registration) connect flows need that
 * same nonce as a Redis key BEFORE the callback comes back — so this reads
 * it straight out of the state's public, unsigned body segment. Safe to do
 * without verifying the signature: the caller just created this exact
 * state a moment ago in the same request.
 */
export function peekStateNonce(state: string): string {
  const [body] = state.split('.');
  if (!body) throw new Error('OAuth state inválido');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { nonce?: string };
  if (!payload.nonce) throw new Error('OAuth state sin nonce');
  return payload.nonce;
}
