import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'crypto';
import { isCloudflareIp } from './cloudflare-ips';

/**
 * Today there's no `trust proxy`, so `req.ip` is Traefik's container IP and
 * every caller shares one throttler bucket (the DoS). With `trust proxy`
 * set (see main.ts), `req.ip` becomes the real peer Traefik saw. We only
 * trust `cf-connecting-ip` when that peer is an actual Cloudflare edge —
 * otherwise a direct hit to the origin could spoof it.
 *
 * No constructor here on purpose: it inherits ThrottlerGuard's own
 * (options, storageService, reflector), all resolvable by Nest already.
 * Adding a constructor param here that Nest can't resolve crash-loops the
 * API at boot (see DI notes in CLAUDE.md / agent memory).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const peer = req.ip as string;
    if (isCloudflareIp(peer) && req.headers?.['cf-connecting-ip']) {
      return String(req.headers['cf-connecting-ip']);
    }
    return peer;
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const rawKey = req.headers?.['x-api-key'];
    if (!rawKey || typeof rawKey !== 'string') return false;

    const exemptHashes = (process.env.THROTTLE_EXEMPT_KEY_HASHES || '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (exemptHashes.length === 0) return false;

    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyHashBuf = Buffer.from(keyHash, 'hex');
    return exemptHashes.some((hash) => {
      const hashBuf = Buffer.from(hash, 'hex');
      if (hashBuf.length !== keyHashBuf.length) return false;
      return timingSafeEqual(hashBuf, keyHashBuf);
    });
  }
}
