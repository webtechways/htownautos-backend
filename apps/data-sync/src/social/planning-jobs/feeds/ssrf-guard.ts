import { BadRequestException } from '@nestjs/common';
import * as dns from 'dns';

const DNS_TIMEOUT_MS = 5_000;
export const FEED_FETCH_TIMEOUT_MS = 5_000;
export const FEED_MAX_BYTES = 2 * 1024 * 1024;

/**
 * SSRF guard for user-supplied feed URLs (contract.ts §3.5 "SSRF-safe: http(s)
 * only, no private IPs"). No SSRF helper existed elsewhere in the repo
 * (checked `isPrivateIp`/`ssrf` across apps/libs) — this is a small,
 * self-contained one, duplicated verbatim in
 * apps/data-sync/src/social/planning-jobs/ so the cron doesn't depend on an
 * apps/api import (Nx apps don't import each other).
 *
 * Only validates the FIRST request — `fetchPublicUrl` below refuses to
 * follow redirects (`redirect: 'error'`) specifically so a validated URL
 * can't be redirected server-side into a private address after the DNS
 * check already passed.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('URL invalida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Solo se permiten URLs http:// o https://');
  }

  const addresses = await resolveHostname(url.hostname);
  if (addresses.length === 0) throw new BadRequestException('No se pudo resolver el dominio del feed');
  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) throw new BadRequestException('La URL del feed apunta a una direccion privada o reservada');
  }
  return url;
}

async function resolveHostname(hostname: string): Promise<string[]> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new BadRequestException('Tiempo de espera agotado resolviendo el dominio')), DNS_TIMEOUT_MS));
  const lookup = dns.promises.lookup(hostname, { all: true }).then((results) => results.map((r) => r.address));
  return Promise.race([lookup, timeout]);
}

/** Fetches the URL (already SSRF-validated) with a timeout, no redirects, and a byte cap. */
export async function fetchPublicUrl(url: URL): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!res.ok) throw new BadRequestException(`El feed respondio ${res.status}`);

    const body = res.body;
    if (!body) return res.text();

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > FEED_MAX_BYTES) {
        await reader.cancel();
        throw new BadRequestException('El feed excede el limite de 2 MB');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    if (err instanceof Error && err.name === 'AbortError') throw new BadRequestException('Tiempo de espera agotado obteniendo el feed');
    throw new BadRequestException(`No se pudo obtener el feed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

const IPV4_PRIVATE_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** Exported for unit tests — also used internally by `assertPublicHttpUrl`. */
export function isPrivateOrReservedIp(address: string): boolean {
  if (address.includes(':')) return isPrivateOrReservedIpv6(address);
  return isPrivateOrReservedIpv4(address);
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const addrInt = ipv4ToInt(address);
  if (addrInt === null) return true; // unparseable — fail closed
  return IPV4_PRIVATE_RANGES.some(([base, prefix]) => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (addrInt & mask) === (baseInt & mask);
  });
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 unique local
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // fe80::/10 link-local
  if (normalized.startsWith('ff')) return true; // ff00::/8 multicast
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded IPv4 too.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIpv4(mapped[1]);
  return false;
}
