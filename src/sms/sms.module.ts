import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [SmsController],
  providers: [SmsService, PrismaService],
  exports: [SmsService],
})
export class SmsModule {}
