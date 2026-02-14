import { Module } from '@nestjs/common';
import { TtsController } from './tts.controller';
import { TtsService } from './tts.service';
import { PrismaService } from '../prisma.service';
import { S3Service } from '../media/s3.service';

@Module({
  controllers: [TtsController],
  providers: [TtsService, PrismaService, S3Service],
  exports: [TtsService],
})
export class TtsModule {}
