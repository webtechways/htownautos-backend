import { Module } from '@nestjs/common';
import { PhoneCallsService } from './phone-calls.service';
import { PhoneCallsController } from './phone-calls.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [PhoneCallsController],
  providers: [PhoneCallsService, PrismaService],
  exports: [PhoneCallsService],
})
export class PhoneCallsModule {}
