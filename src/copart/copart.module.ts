import { Module } from '@nestjs/common';
import { CopartController } from './copart.controller';
import { CopartService } from './copart.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [CopartController],
  providers: [CopartService, PrismaService],
  exports: [CopartService],
})
export class CopartModule {}
