import { Module, forwardRef } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsController } from './sms.controller';
import { PrismaService } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { SocialIngestService, SocialNotifierService } from '@htownautos/social';
import { TwilioModule } from '../twilio/twilio.module';

@Module({
  imports: [forwardRef(() => TwilioModule)],
  controllers: [SmsController],
  providers: [SmsService, PrismaService, S3Service, SocialIngestService, SocialNotifierService],
  exports: [SmsService],
})
export class SmsModule {}
