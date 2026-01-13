import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { S3Service, UploadResult } from './s3.service';
import { CreateMediaDto } from './dto/create-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { MediaEntity } from './entities/media.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
  ) {}

  async uploadAndCreate(
    file: Express.Multer.File,
    createMediaDto: CreateMediaDto,
  ): Promise<MediaEntity> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Verify vehicleId exists if provided
    if (createMediaDto.vehicleId) {
      const vehicleExists = await this.prisma.getModel('vehicle').findUnique({
        where: { id: createMediaDto.vehicleId },
      });

      if (!vehicleExists) {
        throw new NotFoundException(`Vehicle with ID ${createMediaDto.vehicleId} not found`);
      }
    }

    // Upload file to S3
    const folder = createMediaDto.vehicleId ? `vehicles/${createMediaDto.vehicleId}` : 'uploads';
    const uploadResult: UploadResult = await this.s3Service.uploadFile(file, folder);

    // Create media record in database
    const media = await this.prisma.getModel('media').create({
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
        isPublic: createMediaDto.isPublic ?? true,
        isActive: true,
        ...(createMediaDto.vehicleId && { vehicleId: createMediaDto.vehicleId }),
      },
    });

    return new MediaEntity(media);
  }

  async findAll(query: QueryMediaDto): Promise<PaginatedResponseDto<MediaEntity>> {
    const { page = 1, limit = 10, vehicleId, mediaType, category, isActive } = query;

    const skip = (page - 1) * limit;

    const where: any = {};

    if (vehicleId !== undefined) {
      const vehicleExists = await this.prisma.getModel('vehicle').findUnique({
        where: { id: vehicleId },
      });

      if (!vehicleExists) {
        throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
      }

      where.vehicleId = vehicleId;
    }

    if (mediaType !== undefined) {
      where.mediaType = mediaType;
    }

    if (category !== undefined) {
      where.category = category;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [data, total] = await Promise.all([
      this.prisma.getModel('media').findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.getModel('media').count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((item: any) => new MediaEntity(item)),
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
    const media = await this.prisma.getModel('media').findUnique({
      where: { id },
    });

    if (!media) {
      throw new NotFoundException(`Media with ID ${id} not found`);
    }

    return new MediaEntity(media);
  }

  async update(id: string, updateMediaDto: UpdateMediaDto): Promise<MediaEntity> {
    const existingMedia = await this.prisma.getModel('media').findUnique({
      where: { id },
    });

    if (!existingMedia) {
      throw new NotFoundException(`Media with ID ${id} not found`);
    }

    // If vehicleId is being changed, verify it exists
    if (updateMediaDto.vehicleId && updateMediaDto.vehicleId !== existingMedia.vehicleId) {
      const vehicleExists = await this.prisma.getModel('vehicle').findUnique({
        where: { id: updateMediaDto.vehicleId },
      });

      if (!vehicleExists) {
        throw new NotFoundException(`Vehicle with ID ${updateMediaDto.vehicleId} not found`);
      }
    }

    const updated = await this.prisma.getModel('media').update({
      where: { id },
      data: {
        ...(updateMediaDto.title !== undefined && { title: updateMediaDto.title }),
        ...(updateMediaDto.description !== undefined && { description: updateMediaDto.description }),
        ...(updateMediaDto.alt !== undefined && { alt: updateMediaDto.alt }),
        ...(updateMediaDto.category !== undefined && { category: updateMediaDto.category }),
        ...(updateMediaDto.vehicleId !== undefined && { vehicleId: updateMediaDto.vehicleId }),
        ...(updateMediaDto.isPublic !== undefined && { isPublic: updateMediaDto.isPublic }),
      },
    });

    return new MediaEntity(updated);
  }

  async remove(id: string): Promise<{ message: string }> {
    const existingMedia = await this.prisma.getModel('media').findUnique({
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
        // Log error but continue with database deletion
        console.error('Error deleting file from S3:', error);
      }
    }

    await this.prisma.getModel('media').delete({
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
