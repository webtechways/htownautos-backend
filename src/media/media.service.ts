import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { S3Service, UploadResult, PresignResult } from './s3.service';
import { CreateMediaDto } from './dto/create-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { PresignMediaDto } from './dto/presign-media.dto';
import { ConfirmMediaDto } from './dto/confirm-media.dto';
import { MediaEntity } from './entities/media.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async uploadAndCreate(
    file: Express.Multer.File,
    createMediaDto: CreateMediaDto,
  ): Promise<MediaEntity> {
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

    // Validate size matches (tolerance: S3 ContentLength must be ≤ 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (head.contentLength > maxSize) {
      this.logger.warn(`File exceeds max size, deleting: ${dto.key} (${head.contentLength} bytes)`);
      await this.s3Service.deleteFile(dto.key);
      throw new BadRequestException(`File exceeds maximum size of 10MB`);
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
          storageBucket: process.env.AWS_S3_BUCKET || '',
          storageKey: dto.key,
          isPublic: !isPrivate,
          isActive: true,
          ...(dto.vehicleId && { vehicleId: dto.vehicleId }),
          ...(dto.buyerId && { buyerId: dto.buyerId }),
          ...(dto.partId && { partId: dto.partId }),
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

    if (media.isPublic) {
      return { url: media.url };
    }

    const url = await this.s3Service.getSignedUrl(media.storageKey, expiresIn);
    return { url };
  }
}
