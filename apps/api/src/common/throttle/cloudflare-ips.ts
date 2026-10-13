import { BlockList } from 'net';

/**
 * Official Cloudflare IP ranges, copied verbatim from
 * https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
 * as of 2026-10-13. Used to decide whether `cf-connecting-ip` can be
 * trusted (only when the peer Traefik saw is actually a Cloudflare edge
 * node) — anything hitting the origin directly can't spoof this header.
 */
const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const blockList = new BlockList();
for (const subnet of CLOUDFLARE_IPV4) {
  const [address, prefix] = subnet.split('/');
  blockList.addSubnet(address, Number(prefix), 'ipv4');
}
for (const subnet of CLOUDFLARE_IPV6) {
  const [address, prefix] = subnet.split('/');
  blockList.addSubnet(address, Number(prefix), 'ipv6');
}

/** True if `ip` falls inside an official Cloudflare edge range. */
export function isCloudflareIp(ip: string | undefined | null): boolean {
  if (!ip) return false;
  // Normalize IPv4-mapped IPv6 addresses (e.g. "::ffff:1.2.3.4") so BlockList
  // (which checks family explicitly) can match them against the IPv4 list.
  const normalized = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  const family = normalized.includes(':') ? 'ipv6' : 'ipv4';
  try {
    return blockList.check(normalized, family);
  } catch {
    return false;
  }
}
