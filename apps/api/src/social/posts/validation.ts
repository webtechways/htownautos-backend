import { BadRequestException } from '@nestjs/common';
import { countChars, PLATFORM_LIMITS, type PublishablePlatform, type MediaKind, type ThreadItem } from '@htownautos/social';
import type { PlatformOptionsView } from './mappers';

/** Verbatim shape of contract.ts `FieldError` / `ValidationErrorBody`. */
export interface FieldError {
  accountId: string | null;
  field: string;
  code: string;
  message: string;
}

export interface ValidationErrorBody {
  statusCode: 400;
  message: string;
  errors: FieldError[];
}

export interface TargetValidationInput {
  accountId: string;
  /** null when the platform isn't publishable at all (e.g. whatsapp). */
  platform: PublishablePlatform | null;
  accountStatus: string;
  content: string;
  mediaKinds: MediaKind[];
  options: PlatformOptionsView;
  thread: ThreadItem[];
  firstComment: string | null | undefined;
}

/** Pure per-target validation against `PLATFORM_LIMITS` + the per-platform option rules in CONTRACT.md §3.3. */
export function validateTarget(input: TargetValidationInput): FieldError[] {
  const errors: FieldError[] = [];
  const push = (field: string, code: string, message: string) => errors.push({ accountId: input.accountId, field, code, message });

  if (input.accountStatus === 'disconnected') {
    push('accountId', 'ACCOUNT_DISCONNECTED', 'Esta cuenta está desconectada — reconéctala antes de publicar.');
    return errors; // nothing else can be validated meaningfully without a platform
  }

  if (!input.platform) {
    push('accountId', 'PLATFORM_NOT_PUBLISHABLE', 'Este canal no admite publicaciones.');
    return errors;
  }

  const limits = PLATFORM_LIMITS[input.platform];

  const chars = countChars(input.content, limits.countMode);
  if (chars > limits.maxChars) {
    push('content', 'TOO_LONG', `El texto excede el límite de ${limits.label} (${chars}/${limits.maxChars}).`);
  }

  const images = input.mediaKinds.filter((k) => k === 'image').length;
  const videos = input.mediaKinds.filter((k) => k === 'video' || k === 'gif').length;
  const documents = input.mediaKinds.filter((k) => k === 'document').length;
  const hasMixed = new Set(input.mediaKinds).size > 1;

  if (images > limits.maxImages) push('mediaIds', 'TOO_MANY_IMAGES', `${limits.label} admite hasta ${limits.maxImages} imágenes.`);
  if (videos > limits.maxVideos) push('mediaIds', 'TOO_MANY_VIDEOS', `${limits.label} admite hasta ${limits.maxVideos} videos.`);
  if (documents > limits.maxDocuments) push('mediaIds', 'TOO_MANY_DOCUMENTS', `${limits.label} admite hasta ${limits.maxDocuments} documentos.`);
  if (hasMixed && !limits.allowsMixedMedia) push('mediaIds', 'MIXED_MEDIA_NOT_ALLOWED', `${limits.label} no permite mezclar tipos de medios.`);
  if (limits.requiresMedia && input.mediaKinds.length === 0) push('mediaIds', 'MEDIA_REQUIRED', `${limits.label} requiere al menos un archivo.`);
  if (limits.requiresVideo && videos === 0) push('mediaIds', 'VIDEO_REQUIRED', `${limits.label} requiere un video.`);

  if (input.thread.length > 0 && !limits.supportsThread) {
    push('thread', 'THREAD_NOT_SUPPORTED', `${limits.label} no admite hilos.`);
  }
  input.thread.forEach((item, i) => {
    const itemChars = countChars(item.content, limits.countMode);
    if (itemChars > limits.maxChars) {
      push(`thread.${i}.content`, 'TOO_LONG', `El texto del hilo #${i + 1} excede el límite de ${limits.label}.`);
    }
  });

  if (input.firstComment && !limits.supportsFirstComment) {
    push('firstComment', 'FIRST_COMMENT_NOT_SUPPORTED', `${limits.label} no admite primer comentario automático.`);
  }

  validatePlatformOptions(input.platform, input.options, images, videos, push);

  return errors;
}

function validatePlatformOptions(
  platform: PublishablePlatform,
  options: PlatformOptionsView,
  images: number,
  videos: number,
  push: (field: string, code: string, message: string) => void,
): void {
  if (platform === 'youtube') {
    const yt = options.youtube as { title?: string } | undefined;
    if (!yt?.title?.trim()) push('options.youtube.title', 'TITLE_REQUIRED', 'YouTube requiere un título.');
  }

  if (platform === 'pinterest') {
    const pin = options.pinterest as { boardId?: string } | undefined;
    if (!pin?.boardId) push('options.pinterest.boardId', 'BOARD_REQUIRED', 'Pinterest requiere un tablero.');
  }

  if (platform === 'tiktok') {
    const tt = options.tiktok as { privacyLevel?: string; brandContentToggle?: boolean; brandOrganicToggle?: boolean } | undefined;
    if (!tt?.privacyLevel) push('options.tiktok.privacyLevel', 'PRIVACY_LEVEL_REQUIRED', 'TikTok requiere un nivel de privacidad.');
    if (tt?.brandContentToggle === undefined) {
      push('options.tiktok.brandContentToggle', 'DISCLOSURE_REQUIRED', 'TikTok requiere declarar si el contenido es una marca patrocinada.');
    }
    if (tt?.brandOrganicToggle === undefined) {
      push('options.tiktok.brandOrganicToggle', 'DISCLOSURE_REQUIRED', 'TikTok requiere declarar si promociona tu propia marca.');
    }
  }

  if (platform === 'instagram') {
    const ig = options.instagram as { postType?: string } | undefined;
    if (ig?.postType === 'reel' && videos === 0) {
      push('options.instagram.postType', 'VIDEO_REQUIRED', 'Un reel de Instagram requiere un video.');
    }
    if (ig?.postType === 'story' && images + videos !== 1) {
      push('options.instagram.postType', 'STORY_MEDIA_INVALID', 'Una historia de Instagram requiere exactamente un archivo.');
    }
  }
}

export function throwIfInvalid(errors: FieldError[]): void {
  if (errors.length === 0) return;
  const body: ValidationErrorBody = {
    statusCode: 400,
    message: 'La publicación no pasa las reglas de la plataforma',
    errors,
  };
  throw new BadRequestException(body);
}
