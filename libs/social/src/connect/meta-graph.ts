/**
 * Shared Meta Graph API base for Facebook/Instagram-via-Facebook/WhatsApp
 * (Threads uses its own `graph.threads.net` host — see `platforms/threads.ts`).
 * Version from `META_GRAPH_VERSION`, default the current stable one at the
 * time this package was written (per docs/social-suite/CONTRACT.md §5).
 */
const DEFAULT_GRAPH_VERSION = 'v23.0';

export function graphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
}

export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${graphVersion()}${path}`;
}
