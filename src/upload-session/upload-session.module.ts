import { Module } from '@nestjs/common';
import { UploadSessionService } from './upload-session.service';
import { UploadSessionController } from './upload-session.controller';
import { UploadSessionPublicController } from './upload-session-public.controller';
import { PrismaModule } from '../prisma.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [PrismaModule, MediaModule],
  controllers: [UploadSessionController, UploadSessionPublicController],
  providers: [UploadSessionService],
})
export class UploadSessionModule {}
