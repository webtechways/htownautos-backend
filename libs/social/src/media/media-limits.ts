import { BadRequestException } from '@nestjs/common';
import type { MediaKind } from '../types';

/** CONTRACT.md §3.2: image ≤ 20 MB, video ≤ 1 GB, document (PDF) ≤ 100 MB. GIFs ride the image cap. */
export const MEDIA_SIZE_LIMITS: Record<MediaKind, number> = {
  image: 20 * 1024 * 1024,
  gif: 20 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

export function kindFromMime(mimeType: string): MediaKind {
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf') return 'document';
  throw new BadRequestException(`Tipo de archivo no soportado: ${mimeType}`);
}

export function extensionFromMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] || mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
}

export function assertWithinSizeLimit(mimeType: string, sizeBytes: number): MediaKind {
  const kind = kindFromMime(mimeType);
  const limit = MEDIA_SIZE_LIMITS[kind];
  if (sizeBytes > limit) {
    const limitMb = Math.round(limit / (1024 * 1024));
    throw new BadRequestException(`Archivo demasiado grande para ${kind} (máx ${limitMb} MB)`);
  }
  return kind;
}
