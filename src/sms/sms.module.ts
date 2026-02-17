import { Module, forwardRef } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { PrismaService } from '../prisma.service';
import { TwilioModule } from '../twilio/twilio.module';

@Module({
  imports: [forwardRef(() => TwilioModule)],
  controllers: [SmsController],
  providers: [SmsService, PrismaService],
  exports: [SmsService],
})
export class SmsModule {}
