import { Injectable } from '@nestjs/common';
import { Readable } from 'stream';
import sharp from 'sharp';
import { S3Service } from '@htownautos/common';

export interface MediaKeyLike {
  key: string;
}

/** Anything with a `.key` (a `SocialMedia` row, a `{ key }` pick) or a bare S3 key string. */
export type MediaOrKey = MediaKeyLike | string;

function keyOf(m: MediaOrKey): string {
  return typeof m === 'string' ? m : m.key;
}

const DEFAULT_TTL_SEC = 3600;
const JPEG_QUALITY_STEPS = [80, 65, 50, 35];

/**
 * Resolves Social Suite media (private bucket, `social/<tenantId>/…`) for
 * every package that needs the bytes or a URL — this api's own media
 * endpoints, the publisher (platform upload APIs), and the inbox (MMS/media
 * attachments). Not registered in any module of its own: callers add
 * `MediaResolverService` + `S3Service` to their own module's `providers`
 * (both plain `@Injectable`s with no unresolvable constructor args).
 */
@Injectable()
export class MediaResolverService {
  constructor(private readonly s3: S3Service) {}

  /** Signed GET URL, default ~1h — never persisted, ask again next time (per CONTRACT.md §3.2). */
  async signedUrl(media: MediaOrKey, ttlSec: number = DEFAULT_TTL_SEC): Promise<string> {
    return this.s3.getSignedUrl(keyOf(media), ttlSec);
  }

  async buffer(media: MediaOrKey): Promise<Buffer> {
    return this.s3.downloadBuffer(keyOf(media));
  }

  /**
   * NOTE: backed by `S3Service.downloadBuffer`, which reads the whole object
   * into memory before this can start streaming it — there's no true
   * range/streaming GET exposed by the shared S3Service today. Fine for
   * images/documents; large video callers should prefer `buffer()` directly
   * and watch memory if they need true streaming (not needed by anything in
   * this package).
   */
  async stream(media: MediaOrKey): Promise<Readable> {
    return Readable.from(await this.buffer(media));
  }

  /** Re-encodes to JPEG (platforms that reject PNG/WebP/etc. for a given surface). */
  async toJpeg(media: MediaOrKey, quality = 85): Promise<Buffer> {
    const buf = await this.buffer(media);
    return sharp(buf).rotate().jpeg({ quality, mozjpeg: true }).toBuffer();
  }

  /**
   * Re-encodes to JPEG under `maxBytes`, stepping quality down and — if
   * still too big — halving width, until it fits or the quality floor is
   * hit. Used before handing a platform upload API bytes it would otherwise
   * reject for size (e.g. Threads/X image caps).
   */
  async fitUnder(media: MediaOrKey, maxBytes: number): Promise<Buffer> {
    let buf = await this.buffer(media);
    if (buf.length <= maxBytes) return buf;

    for (const quality of JPEG_QUALITY_STEPS) {
      buf = await sharp(buf).rotate().jpeg({ quality, mozjpeg: true }).toBuffer();
      if (buf.length <= maxBytes) return buf;
    }

    // Still too big at the lowest quality step — halve dimensions and retry once more at the floor quality.
    const meta = await sharp(buf).metadata();
    const width = meta.width ? Math.round(meta.width / 2) : undefined;
    return sharp(buf)
      .resize({ width })
      .jpeg({ quality: JPEG_QUALITY_STEPS[JPEG_QUALITY_STEPS.length - 1], mozjpeg: true })
      .toBuffer();
  }
}
