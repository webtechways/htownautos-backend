import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { MediaService } from '../media/media.service';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { PresignMediaDto } from '../media/dto/presign-media.dto';
import { ConfirmMediaDto } from '../media/dto/confirm-media.dto';
import { MediaEntity } from '../media/entities/media.entity';

const SESSION_TTL_MINUTES = 15;

@Injectable()
export class UploadSessionService {
  private readonly logger = new Logger(UploadSessionService.name);

  constructor(
    private prisma: PrismaService,
    private mediaService: MediaService,
  ) {}

  /**
   * Create a new upload session with a cryptographic token
   */
  async create(
    dto: CreateUploadSessionDto,
    userId: string,
    tenantId?: string,
  ) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(
      Date.now() + SESSION_TTL_MINUTES * 60 * 1000,
    );

    const session = await this.prisma.uploadSession.create({
      data: {
        token,
        expiresAt,
        entityType: dto.entityType,
        entityId: dto.entityId,
        mediaType: dto.mediaType || 'image',
        category: dto.category,
        isPublic: dto.isPublic ?? true,
        userId,
        tenantId,
      },
    });

    return {
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Validate a session token — used by public endpoints
   */
  async validate(token: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { token },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    if (session.closed) {
      throw new BadRequestException('Upload session has been closed');
    }

    if (new Date() > session.expiresAt) {
      throw new BadRequestException('Upload session has expired');
    }

    // Mark as used on first access
    if (!session.used) {
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { used: true },
      });
    }

    return session;
  }

  /**
   * Get session info for mobile page (public, minimal data)
   */
  async getPublicInfo(token: string) {
    const session = await this.validate(token);
    return {
      entityType: session.entityType,
      mediaType: session.mediaType,
      category: session.category,
      isPublic: session.isPublic,
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Presign an upload using the session's entity context
   */
  async presign(token: string, dto: PresignMediaDto): Promise<any> {
    const session = await this.validate(token);

    // Override entity association from session
    const presignDto: PresignMediaDto = {
      ...dto,
      mediaType: (session.mediaType as any) || dto.mediaType,
      category: (session.category as any) || dto.category,
      isPublic: session.isPublic,
    };

    // Map entityType to the correct field
    if (session.entityType === 'vehicle') {
      presignDto.vehicleId = session.entityId;
    } else if (session.entityType === 'buyer') {
      presignDto.buyerId = session.entityId;
    }

    return this.mediaService.presign(presignDto);
  }

  /**
   * Confirm an upload using the session's entity context
   */
  async confirm(token: string, dto: ConfirmMediaDto): Promise<MediaEntity> {
    const session = await this.validate(token);

    // Override entity association from session
    const confirmDto: ConfirmMediaDto = {
      ...dto,
      mediaType: (session.mediaType as any) || dto.mediaType,
      category: (session.category as any) || dto.category,
      isPublic: session.isPublic,
    };

    if (session.entityType === 'vehicle') {
      confirmDto.vehicleId = session.entityId;
    } else if (session.entityType === 'buyer') {
      confirmDto.buyerId = session.entityId;
    }

    return this.mediaService.confirmUpload(confirmDto);
  }

  /**
   * Get media uploaded during this session (for polling)
   */
  async getSessionMedia(token: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { token },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    const where: any = {
      createdAt: { gte: session.createdAt },
    };

    if (session.entityType === 'vehicle') {
      where.vehicleId = session.entityId;
    } else if (session.entityType === 'buyer') {
      where.buyerId = session.entityId;
    }

    if (session.category) {
      where.category = session.category;
    }

    const media = await this.prisma.media.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return media.map((m) => new MediaEntity(m));
  }

  /**
   * Close/invalidate a session
   */
  async close(token: string, userId: string) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { token },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    // Only the owner can close a session
    if (session.userId !== userId) {
      throw new BadRequestException('Not authorized to close this session');
    }

    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { closed: true },
    });

    return { message: 'Session closed' };
  }

  /**
   * Cleanup expired sessions older than 24 hours
   */
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupExpiredSessions() {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await this.prisma.uploadSession.deleteMany({
        where: {
          expiresAt: { lt: cutoff },
        },
      });

      if (result.count > 0) {
        this.logger.log(`Cleaned up ${result.count} expired upload sessions`);
      }
    } catch {
      this.logger.warn('Failed to cleanup expired upload sessions (database unreachable)');
    }
  }
}
