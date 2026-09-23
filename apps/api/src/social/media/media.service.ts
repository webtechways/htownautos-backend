import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import type { SocialMedia as PrismaSocialMedia } from '@prisma/client';
import { MediaResolverService, assertWithinSizeLimit, extensionFromMime, type MediaKind } from '@htownautos/social';
import { MediaUploadUrlDto, RegisterMediaDto } from './dto';

const UPLOAD_URL_TTL_SEC = 300; // 5 minutes to complete the PUT
const SIGNED_GET_TTL_SEC = 3600;

export interface SocialMediaItemView {
  id: string;
  kind: MediaKind;
  mimeType: string;
  fileName: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  altText: string | null;
  url: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface PaginatedMedia {
  data: SocialMediaItemView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class SocialMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly resolver: MediaResolverService,
  ) {}

  async createUploadUrl(tenantId: string, dto: MediaUploadUrlDto) {
    assertWithinSizeLimit(dto.mimeType, dto.sizeBytes);
    const ext = extensionFromMime(dto.mimeType);
    const { uploadUrl, key } = await this.s3.generatePresignedPutUrl(
      `social/${tenantId}`,
      ext,
      dto.mimeType,
      true,
      UPLOAD_URL_TTL_SEC,
    );

    return {
      key,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': dto.mimeType },
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SEC * 1000).toISOString(),
    };
  }

  async register(tenantId: string, userId: string | null, dto: RegisterMediaDto): Promise<SocialMediaItemView> {
    const kind = assertWithinSizeLimit(dto.mimeType, dto.sizeBytes);

    // The key came back from our own presigned PUT — it must live under this tenant's prefix.
    if (!dto.key.startsWith(`social/${tenantId}/`)) {
      throw new ForbiddenException('El key no pertenece a este tenant');
    }

    const head = await this.s3.headObject(dto.key);
    if (!head.exists) {
      throw new BadRequestException('El archivo no se encontró en el almacenamiento — la subida no se completó');
    }
    if (head.contentLength !== dto.sizeBytes) {
      throw new BadRequestException('El tamaño reportado no coincide con el archivo subido');
    }

    const row = await this.prisma.socialMedia.create({
      data: {
        tenantId,
        key: dto.key,
        kind,
        mimeType: dto.mimeType,
        fileName: dto.fileName,
        sizeBytes: dto.sizeBytes,
        width: dto.width ?? null,
        height: dto.height ?? null,
        durationSec: dto.durationSec ?? null,
        altText: dto.altText ?? null,
        thumbnailKey: dto.thumbnailKey ?? null,
        createdById: userId,
      },
    });
    return this.toItem(row);
  }

  async list(tenantId: string, page: number, limit: number): Promise<PaginatedMedia> {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.socialMedia.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.socialMedia.count({ where: { tenantId } }),
    ]);
    const data = await Promise.all(rows.map((r) => this.toItem(r)));
    return { data, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async patchAltText(tenantId: string, id: string, altText: string): Promise<SocialMediaItemView> {
    const row = await this.ensureMedia(id, tenantId);
    const updated = await this.prisma.socialMedia.update({ where: { id: row.id }, data: { altText } });
    return this.toItem(updated);
  }

  /** 409 when a not-yet-published post or an idea still references this media (CONTRACT.md §3.2). */
  async remove(tenantId: string, id: string): Promise<{ message: string }> {
    const row = await this.ensureMedia(id, tenantId);

    const usedByPost = await this.prisma.socialPost.findFirst({
      where: { tenantId, mediaIds: { has: id }, status: { notIn: ['published', 'partial'] } },
      select: { id: true },
    });
    if (usedByPost) throw new ConflictException('Este archivo está en uso por una publicación no publicada');

    const usedByIdea = await this.prisma.socialIdea.findFirst({
      where: { tenantId, mediaIds: { has: id } },
      select: { id: true },
    });
    if (usedByIdea) throw new ConflictException('Este archivo está en uso por una idea');

    const usedByTargetOverride = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "social_post_targets"
      WHERE "tenantId" = ${tenantId}
        AND status NOT IN ('published', 'cancelled')
        AND "mediaOverride" @> ${JSON.stringify([id])}::jsonb
      LIMIT 1
    `;
    if (usedByTargetOverride.length > 0) throw new ConflictException('Este archivo está en uso por una publicación no publicada');

    await this.prisma.socialMedia.delete({ where: { id: row.id } });
    await this.s3.deleteFile(row.key).catch(() => undefined);
    if (row.thumbnailKey) await this.s3.deleteFile(row.thumbnailKey).catch(() => undefined);

    return { message: 'Archivo eliminado' };
  }

  private async ensureMedia(id: string, tenantId: string): Promise<PrismaSocialMedia> {
    const row = await this.prisma.socialMedia.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Media not found');
    return row;
  }

  private async toItem(row: PrismaSocialMedia): Promise<SocialMediaItemView> {
    const [url, thumbnailUrl] = await Promise.all([
      this.resolver.signedUrl(row, SIGNED_GET_TTL_SEC),
      row.thumbnailKey ? this.resolver.signedUrl(row.thumbnailKey, SIGNED_GET_TTL_SEC) : Promise.resolve(null),
    ]);

    return {
      id: row.id,
      kind: row.kind as MediaKind,
      mimeType: row.mimeType,
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      width: row.width,
      height: row.height,
      durationSec: row.durationSec,
      altText: row.altText,
      url,
      thumbnailUrl,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
