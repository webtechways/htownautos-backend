/**
 * Reads a signed GET URL in fixed-size chunks via HTTP `Range` requests, so a
 * chunked-upload publisher (YouTube resumable, X media APPEND, TikTok
 * FILE_UPLOAD) never has to hold the whole video in memory — only one chunk
 * at a time. `totalBytes` comes from the `SocialMedia` row (already known),
 * so no HEAD request is needed first.
 */
export interface RangeChunk {
  buffer: Buffer;
  start: number;
  end: number;
  isLast: boolean;
}

export async function* iterateRangeChunks(url: string, totalBytes: number, chunkSize: number): AsyncGenerator<RangeChunk> {
  if (totalBytes <= 0) return;
  let start = 0;
  while (start < totalBytes) {
    const end = Math.min(start + chunkSize, totalBytes) - 1;
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (!res.ok && res.status !== 206) {
      throw new Error(`No se pudo leer el rango bytes=${start}-${end} del medio: HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    yield { buffer, start, end, isLast: end >= totalBytes - 1 };
    start = end + 1;
  }
}
