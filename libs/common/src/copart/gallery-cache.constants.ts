import type { GalleryImage } from './copart-images.service';

/** RabbitMQ queue that drives S3 gallery caching (consumed by image-service). */
export const GALLERY_CACHE_QUEUE = 'gallery.cache';

/**
 * Message published to {@link GALLERY_CACHE_QUEUE}. `jobId` links the message to an
 * ImageCacheJob row so the consumer can finalize its status; it is absent for the
 * on-demand path (which has no job row).
 */
export interface GalleryCacheMessage {
  lotNumber: string;
  images: GalleryImage[];
  jobId?: string;
  /** Which auction the lot belongs to. Absent = COPART (messages from before IAAI). */
  auction?: 'COPART' | 'IAAI';
}
