import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@htownautos/prisma';
import { S3Service, UploadResult, PresignResult } from '@htownautos/common';
import { CreateMediaDto } from './dto/create-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { PresignMediaDto } from './dto/presign-media.dto';
import { ConfirmMediaDto } from './dto/confirm-media.dto';
import { InitMultipartDto } from './dto/init-multipart.dto';
import { CompleteMultipartDto } from './dto/complete-multipart.dto';
import { AbortMultipartDto } from './dto/abort-multipart.dto';
import { MediaEntity } from './entities/media.entity';
import { PaginatedResponseDto } from '@htownautos/common';
import sharp from 'sharp';

/** El bucket donde acaba un fichero segun sea publico o privado. */
function bucketFor(isPublic: boolean): string {
  return (isPublic ? process.env.B2_BUCKET_PUBLIC : process.env.B2_BUCKET_PRIVATE) || '';
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  private readonly IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  private readonly MAX_DIMENSION = 2400;
  private readonly JPEG_QUALITY = 82;
  private readonly WEBP_QUALITY = 80;

  /**
   * Optimize image using sharp: resize if too large, compress, convert to efficient format.
   * Returns the optimized buffer and updated file metadata.
   */
  private async optimizeImage(file: Express.Multer.File): Promise<Express.Multer.File> {
    if (!this.IMAGE_MIMES.includes(file.mimetype)) return file;

    try {
      const image = sharp(file.buffer);
      const metadata = await image.metadata();

      const needsResize =
        (metadata.width && metadata.width > this.MAX_DIMENSION) ||
        (metadata.height && metadata.height > this.MAX_DIMENSION);

      let pipeline = image;

      if (needsResize) {
        pipeline = pipeline.resize(this.MAX_DIMENSION, this.MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Auto-rotate based on EXIF
      pipeline = pipeline.rotate();

      let outputBuffer: Buffer;
      let outputMime: string;
      let outputName: string;

      if (file.mimetype === 'image/png' && metadata.hasAlpha) {
        // Keep PNG for images with transparency
        outputBuffer = await pipeline.png({ quality: 90, compressionLevel: 9 }).toBuffer();
        outputMime = 'image/png';
        outputName = file.originalname;
      } else if (file.mimetype === 'image/gif') {
        // Don't process GIFs (may be animated)
        return file;
      } else {
        // Convert everything else to WebP for best compression
        outputBuffer = await pipeline.webp({ quality: this.WEBP_QUALITY }).toBuffer();
        outputMime = 'image/webp';
        outputName = file.originalname.replace(/\.[^.]+$/, '.webp');
      }

      const savedBytes = file.buffer.length - outputBuffer.length;
      if (savedBytes > 0) {
        this.logger.log(
          `[Sharp] Optimized ${file.originalname}: ${(file.buffer.length / 1024).toFixed(0)}KB → ${(outputBuffer.length / 1024).toFixed(0)}KB (saved ${(savedBytes / 1024).toFixed(0)}KB)`,
        );
        return {
          ...file,
          buffer: outputBuffer,
          size: outputBuffer.length,
          mimetype: outputMime,
          originalname: outputName,
        };
      }

      // If optimization didn't save space, return original
      return file;
    } catch (error) {
      this.logger.warn(`[Sharp] Failed to optimize ${file.originalname}: ${error.message}`);
      return file; // Return original on failure
    }
  }

  async uploadAndCreate(
    file: Express.Multer.File,
    createMediaDto: CreateMediaDto,
  ): Promise<MediaEntity> {
    // Optimize image before upload
    file = await this.optimizeImage(file);

    // Verify vehicleId exists if provided
    if (createMediaDto.vehicleId) {
      const exists = await this.prisma.vehicle.findUnique({
        where: { id: createMediaDto.vehicleId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Vehicle with ID ${createMediaDto.vehicleId} not found`);
      }
    }

    // Verify buyerId exists if provided
    if (createMediaDto.buyerId) {
      const exists = await this.prisma.buyer.findUnique({
        where: { id: createMediaDto.buyerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Buyer with ID ${createMediaDto.buyerId} not found`);
      }
    }

    // Verify partId exists if provided
    if (createMediaDto.partId) {
      const exists = await this.prisma.part.findUnique({
        where: { id: createMediaDto.partId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Part with ID ${createMediaDto.partId} not found`);
      }
    }

    // If buyerId is provided, ALWAYS set isPublic to false (buyer media is private)
    const isPrivate = !!createMediaDto.buyerId || !(createMediaDto.isPublic ?? true);

    // Determine folder based on association
    let folder = 'uploads';
    if (createMediaDto.buyerId) {
      folder = `buyers/${createMediaDto.buyerId}`;
    } else if (createMediaDto.vehicleId) {
      folder = `vehicles/${createMediaDto.vehicleId}`;
    } else if (createMediaDto.partId) {
      folder = `parts/${createMediaDto.partId}`;
    }

    // Upload file to S3
    const uploadResult: UploadResult = await this.s3Service.uploadFile(file, folder, isPrivate);

    // Create media record — clean up S3 if DB write fails
    try {
      const media = await this.prisma.media.create({
        data: {
          filename: file.originalname,
          url: uploadResult.url,
          path: uploadResult.key,
          mimeType: uploadResult.mimeType,
          size: uploadResult.size,
          mediaType: createMediaDto.mediaType,
          category: createMediaDto.category,
          title: createMediaDto.title,
          description: createMediaDto.description,
          alt: createMediaDto.alt,
          storageProvider: 's3',
          storageBucket: uploadResult.bucket,
          storageKey: uploadResult.key,
          isPublic: !isPrivate,
          isActive: true,
          ...(createMediaDto.vehicleId && { vehicleId: createMediaDto.vehicleId }),
          ...(createMediaDto.buyerId && { buyerId: createMediaDto.buyerId }),
          ...(createMediaDto.partId && { partId: createMediaDto.partId }),
          ...(createMediaDto.inspectionId && { inspectionId: createMediaDto.inspectionId }),
          ...(createMediaDto.inspectionChecklistItemId && {
            inspectionChecklistItemId: createMediaDto.inspectionChecklistItemId,
          }),
          ...(createMediaDto.inspectionRequestItemId && {
            inspectionRequestItemId: createMediaDto.inspectionRequestItemId,
          }),
          ...(createMediaDto.inspectionErrorCodeId && {
            inspectionErrorCodeId: createMediaDto.inspectionErrorCodeId,
          }),
          ...(createMediaDto.carfaxReportId && { carfaxReportId: createMediaDto.carfaxReportId }),
        },
      });

      return new MediaEntity(media);
    } catch (error) {
      // DB create failed — remove orphaned S3 file
      this.logger.warn(`DB create failed, cleaning up S3 key: ${uploadResult.key}`);
      try {
        await this.s3Service.deleteFile(uploadResult.key);
      } catch (cleanupErr) {
        this.logger.error(`Failed to clean up orphaned S3 file: ${uploadResult.key}`, cleanupErr);
      }
      throw error;
    }
  }

  /** Step 1: Generate presigned PUT URL for direct client-to-S3 upload */
  async presign(dto: PresignMediaDto): Promise<PresignResult> {
    if (dto.vehicleId) {
      const exists = await this.prisma.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Vehicle with ID ${dto.vehicleId} not found`);
      }
    }

    if (dto.buyerId) {
      const exists = await this.prisma.buyer.findUnique({
        where: { id: dto.buyerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Buyer with ID ${dto.buyerId} not found`);
      }
    }

    if (dto.partId) {
      const exists = await this.prisma.part.findUnique({
        where: { id: dto.partId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Part with ID ${dto.partId} not found`);
      }
    }

    const isPrivate = !!dto.buyerId || !(dto.isPublic ?? true);

    let folder = 'uploads';
    if (dto.buyerId) {
      folder = `buyers/${dto.buyerId}`;
    } else if (dto.vehicleId) {
      folder = `vehicles/${dto.vehicleId}`;
    } else if (dto.partId) {
      folder = `parts/${dto.partId}`;
    }

    const fileExtension = dto.filename.split('.').pop() || 'bin';

    return this.s3Service.generatePresignedPutUrl(
      folder,
      fileExtension,
      dto.contentType,
      isPrivate,
    );
  }

  /** Step 2: Confirm upload — verify file in S3, create DB record */
  async confirmUpload(dto: ConfirmMediaDto): Promise<MediaEntity> {
    // Verify file exists in S3
    const head = await this.s3Service.headObject(dto.key);
    if (!head.exists) {
      throw new BadRequestException('File not found in S3. Upload may have failed.');
    }

    // Validate size matches (tolerance: S3 ContentLength must be ≤ 20MB)
    const maxSize = 20 * 1024 * 1024;
    if (head.contentLength > maxSize) {
      this.logger.warn(`File exceeds max size, deleting: ${dto.key} (${head.contentLength} bytes)`);
      await this.s3Service.deleteFile(dto.key);
      throw new BadRequestException(`File exceeds maximum size of 20MB`);
    }

    // Validate vehicleId/buyerId exist
    if (dto.vehicleId) {
      const exists = await this.prisma.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Vehicle with ID ${dto.vehicleId} not found`);
      }
    }

    if (dto.buyerId) {
      const exists = await this.prisma.buyer.findUnique({
        where: { id: dto.buyerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Buyer with ID ${dto.buyerId} not found`);
      }
    }

    if (dto.partId) {
      const exists = await this.prisma.part.findUnique({
        where: { id: dto.partId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Part with ID ${dto.partId} not found`);
      }
    }

    const isPrivate = !!dto.buyerId || !(dto.isPublic ?? true);
    const publicUrl = this.s3Service.buildPublicUrl(dto.key);

    // Create media record — clean up S3 if DB write fails
    try {
      const media = await this.prisma.media.create({
        data: {
          filename: dto.filename,
          url: publicUrl,
          path: dto.key,
          mimeType: dto.contentType,
          size: head.contentLength,
          mediaType: dto.mediaType,
          category: dto.category,
          title: dto.title,
          description: dto.description,
          alt: dto.alt,
          storageProvider: 's3',
          // Solo se guarda para saber donde quedo el fichero. `isPublic` decide
          // cual, igual que decide a que perfil se subio.
          storageBucket: bucketFor(!isPrivate),
          storageKey: dto.key,
          isPublic: !isPrivate,
          isActive: true,
          ...(dto.vehicleId && { vehicleId: dto.vehicleId }),
          ...(dto.buyerId && { buyerId: dto.buyerId }),
          ...(dto.partId && { partId: dto.partId }),
          ...(dto.inspectionId && { inspectionId: dto.inspectionId }),
          ...(dto.inspectionChecklistItemId && {
            inspectionChecklistItemId: dto.inspectionChecklistItemId,
          }),
          ...(dto.inspectionRequestItemId && {
            inspectionRequestItemId: dto.inspectionRequestItemId,
          }),
          ...(dto.inspectionErrorCodeId && {
            inspectionErrorCodeId: dto.inspectionErrorCodeId,
          }),
          ...(dto.carfaxReportId && { carfaxReportId: dto.carfaxReportId }),
        },
      });

      return new MediaEntity(media);
    } catch (error) {
      this.logger.warn(`DB create failed, cleaning up S3 key: ${dto.key}`);
      try {
        await this.s3Service.deleteFile(dto.key);
      } catch (cleanupErr) {
        this.logger.error(`Failed to clean up orphaned S3 file: ${dto.key}`, cleanupErr);
      }
      throw error;
    }
  }

  // ─── Multipart upload (videos / large files) ──────────────────────────
  //
  // The browser streams a file in N parts (~8MB each) directly to S3 using
  // presigned PUT URLs, then asks us to "complete" the multipart so S3
  // reassembles the object. We model that as init → (parts uploaded by
  // browser) → complete | abort. Smaller files keep using presign/confirm.

  /** Hard part size for multipart uploads. 8MB is well over S3's 5MB
   *  minimum and is a reasonable single-request size on phone uplinks. */
  private readonly MULTIPART_PART_SIZE = 8 * 1024 * 1024;
  /** Cap on parts per upload — matches S3's hard limit. */
  private readonly MULTIPART_MAX_PARTS = 10000;

  /** Pick the same S3 folder the presign flow uses, so multipart and
   *  presign uploads end up co-located by association. */
  private folderForDto(dto: { vehicleId?: string; buyerId?: string; partId?: string }): string {
    if (dto.buyerId) return `buyers/${dto.buyerId}`;
    if (dto.vehicleId) return `vehicles/${dto.vehicleId}`;
    if (dto.partId) return `parts/${dto.partId}`;
    return 'uploads';
  }

  /** Step 1: validate, generate the S3 key, init the multipart on S3,
   *  presign N upload-part URLs and hand them back to the client. */
  async initMultipart(dto: InitMultipartDto): Promise<{
    uploadId: string;
    key: string;
    partUrls: { partNumber: number; url: string }[];
    partSize: number;
    partCount: number;
  }> {
    // Validate FK targets exist (same checks as presign — keeps the two
    // entry points behaviorally identical).
    if (dto.vehicleId) {
      const exists = await this.prisma.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Vehicle with ID ${dto.vehicleId} not found`);
      }
    }
    if (dto.buyerId) {
      const exists = await this.prisma.buyer.findUnique({
        where: { id: dto.buyerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Buyer with ID ${dto.buyerId} not found`);
      }
    }
    if (dto.partId) {
      const exists = await this.prisma.part.findUnique({
        where: { id: dto.partId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Part with ID ${dto.partId} not found`);
      }
    }

    const partSize = this.MULTIPART_PART_SIZE;
    const partCount = Math.ceil(dto.fileSize / partSize);
    if (partCount < 1 || partCount > this.MULTIPART_MAX_PARTS) {
      throw new BadRequestException(
        `Invalid part count ${partCount} for file size ${dto.fileSize}`,
      );
    }

    const folder = this.folderForDto(dto);
    const fileExtension = dto.filename.split('.').pop() || 'bin';
    const key = this.s3Service.generateKey(folder, fileExtension);

    const { uploadId } = await this.s3Service.initMultipartUpload(key, dto.contentType);

    // Presign all parts in parallel so the client can start uploading
    // immediately. Presigned URLs expire after 1h — plenty for any
    // single upload, way less than the multipart's own lifetime.
    const partUrls = await Promise.all(
      Array.from({ length: partCount }, (_, i) => i + 1).map(async (partNumber) => ({
        partNumber,
        url: await this.s3Service.presignUploadPart(key, uploadId, partNumber),
      })),
    );

    this.logger.log(
      `Multipart init: key=${key} parts=${partCount} size=${dto.fileSize}`,
    );

    return { uploadId, key, partUrls, partSize, partCount };
  }

  /** Step 2: finalize the multipart, verify the object, create the
   *  Media row. Mirrors confirmUpload(...) but without the 20MB cap. */
  async completeMultipart(dto: CompleteMultipartDto): Promise<MediaEntity> {
    // Tell S3 to assemble the parts. If a part is missing / ETag is
    // wrong / order is wrong, this throws with a clear error.
    await this.s3Service.completeMultipartUpload(
      dto.key,
      dto.uploadId,
      dto.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
    );

    // Confirm the final object exists and get its real size/contentType.
    const head = await this.s3Service.headObject(dto.key);
    if (!head.exists) {
      throw new BadRequestException(
        'Multipart upload completed but object is not visible in S3',
      );
    }

    // FK existence checks again (object is already in S3; we still want
    // to fail loud rather than orphan it silently).
    if (dto.vehicleId) {
      const exists = await this.prisma.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Vehicle with ID ${dto.vehicleId} not found`);
      }
    }
    if (dto.buyerId) {
      const exists = await this.prisma.buyer.findUnique({
        where: { id: dto.buyerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Buyer with ID ${dto.buyerId} not found`);
      }
    }
    if (dto.partId) {
      const exists = await this.prisma.part.findUnique({
        where: { id: dto.partId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Part with ID ${dto.partId} not found`);
      }
    }

    const isPrivate = !!dto.buyerId || !(dto.isPublic ?? true);
    const publicUrl = this.s3Service.buildPublicUrl(dto.key);

    try {
      const media = await this.prisma.media.create({
        data: {
          filename: dto.filename,
          url: publicUrl,
          path: dto.key,
          mimeType: dto.contentType,
          size: head.contentLength,
          mediaType: dto.mediaType,
          category: dto.category,
          title: dto.title,
          description: dto.description,
          alt: dto.alt,
          storageProvider: 's3',
          // Solo se guarda para saber donde quedo el fichero. `isPublic` decide
          // cual, igual que decide a que perfil se subio.
          storageBucket: bucketFor(!isPrivate),
          storageKey: dto.key,
          isPublic: !isPrivate,
          isActive: true,
          ...(dto.vehicleId && { vehicleId: dto.vehicleId }),
          ...(dto.buyerId && { buyerId: dto.buyerId }),
          ...(dto.partId && { partId: dto.partId }),
          ...(dto.inspectionId && { inspectionId: dto.inspectionId }),
          ...(dto.inspectionChecklistItemId && {
            inspectionChecklistItemId: dto.inspectionChecklistItemId,
          }),
          ...(dto.inspectionRequestItemId && {
            inspectionRequestItemId: dto.inspectionRequestItemId,
          }),
          ...(dto.inspectionErrorCodeId && {
            inspectionErrorCodeId: dto.inspectionErrorCodeId,
          }),
          ...(dto.carfaxReportId && { carfaxReportId: dto.carfaxReportId }),
        },
      });

      return new MediaEntity(media);
    } catch (error) {
      this.logger.warn(`DB create failed after multipart, cleaning up S3 key: ${dto.key}`);
      try {
        await this.s3Service.deleteFile(dto.key);
      } catch (cleanupErr) {
        this.logger.error(
          `Failed to clean up orphaned S3 object: ${dto.key}`,
          cleanupErr,
        );
      }
      throw error;
    }
  }

  /** Step 2 (failure path): tell S3 to discard the in-flight parts. */
  async abortMultipart(dto: AbortMultipartDto): Promise<{ aborted: true }> {
    await this.s3Service.abortMultipartUpload(dto.key, dto.uploadId);
    return { aborted: true };
  }

  async findAll(query: QueryMediaDto): Promise<PaginatedResponseDto<MediaEntity>> {
    const { page = 1, limit = 10, vehicleId, buyerId, partId, mediaType, category, isActive } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.MediaWhereInput = {};

    if (vehicleId !== undefined) {
      const exists = await this.prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
      }
      where.vehicleId = vehicleId;
    }

    if (buyerId !== undefined) {
      const exists = await this.prisma.buyer.findUnique({
        where: { id: buyerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Buyer with ID ${buyerId} not found`);
      }
      where.buyerId = buyerId;
    }

    if (partId !== undefined) {
      const exists = await this.prisma.part.findUnique({
        where: { id: partId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Part with ID ${partId} not found`);
      }
      where.partId = partId;
    }

    if (mediaType !== undefined) where.mediaType = mediaType;
    if (category !== undefined) where.category = category;
    if (isActive !== undefined) where.isActive = isActive;

    const [data, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.media.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item) => new MediaEntity(item)),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(id: string): Promise<MediaEntity> {
    const media = await this.prisma.media.findUnique({
      where: { id },
    });

    if (!media) {
      throw new NotFoundException(`Media with ID ${id} not found`);
    }

    return new MediaEntity(media);
  }

  async update(id: string, updateMediaDto: UpdateMediaDto): Promise<MediaEntity> {
    const existingMedia = await this.prisma.media.findUnique({
      where: { id },
    });

    if (!existingMedia) {
      throw new NotFoundException(`Media with ID ${id} not found`);
    }

    // If vehicleId is being changed, verify it exists
    if (updateMediaDto.vehicleId && updateMediaDto.vehicleId !== existingMedia.vehicleId) {
      const exists = await this.prisma.vehicle.findUnique({
        where: { id: updateMediaDto.vehicleId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Vehicle with ID ${updateMediaDto.vehicleId} not found`);
      }
    }

    // If buyerId is being changed, verify it exists
    if (updateMediaDto.buyerId && updateMediaDto.buyerId !== existingMedia.buyerId) {
      const exists = await this.prisma.buyer.findUnique({
        where: { id: updateMediaDto.buyerId },
        select: { id: true },
      });
      if (!exists) {
        throw new NotFoundException(`Buyer with ID ${updateMediaDto.buyerId} not found`);
      }
    }

    // If buyerId is provided or exists, media must be private
    const forcePrivate = updateMediaDto.buyerId || existingMedia.buyerId;
    const finalIsPublic = forcePrivate ? false : (updateMediaDto.isPublic ?? existingMedia.isPublic);

    const updated = await this.prisma.media.update({
      where: { id },
      data: {
        ...(updateMediaDto.title !== undefined && { title: updateMediaDto.title }),
        ...(updateMediaDto.description !== undefined && { description: updateMediaDto.description }),
        ...(updateMediaDto.alt !== undefined && { alt: updateMediaDto.alt }),
        ...(updateMediaDto.category !== undefined && { category: updateMediaDto.category }),
        ...(updateMediaDto.vehicleId !== undefined && { vehicleId: updateMediaDto.vehicleId }),
        ...(updateMediaDto.buyerId !== undefined && { buyerId: updateMediaDto.buyerId }),
        isPublic: finalIsPublic,
      },
    });

    return new MediaEntity(updated);
  }

  async remove(id: string): Promise<{ message: string }> {
    const existingMedia = await this.prisma.media.findUnique({
      where: { id },
    });

    if (!existingMedia) {
      throw new NotFoundException(`Media with ID ${id} not found`);
    }

    // Delete file from S3 if storage key exists
    if (existingMedia.storageKey) {
      try {
        await this.s3Service.deleteFile(existingMedia.storageKey);
      } catch (error) {
        this.logger.error(`Error deleting file from S3: ${existingMedia.storageKey}`, error);
      }
    }

    await this.prisma.media.delete({
      where: { id },
    });

    return {
      message: `Media with ID ${id} has been successfully deleted`,
    };
  }

  async getSignedUrl(id: string, expiresIn: number = 3600): Promise<{ url: string }> {
    const media = await this.findOne(id);

    if (!media.storageKey) {
      throw new BadRequestException('Media does not have a storage key');
    }

    // Always generate signed URLs - S3 bucket does not allow public access
    const url = await this.s3Service.getSignedUrl(media.storageKey, expiresIn);
    return { url };
  }
}
