/**
 * Coerces a Node `Buffer` into something TS's DOM lib accepts as a
 * `BodyInit`/`BlobPart`. `Buffer.buffer` is typed `ArrayBufferLike` (which
 * includes `SharedArrayBuffer`), which the stricter DOM types reject even
 * though every buffer here is always backed by a real `ArrayBuffer` — this
 * repo never reads media over a `SharedArrayBuffer`.
 */
export function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as Uint8Array<ArrayBuffer>;
}
