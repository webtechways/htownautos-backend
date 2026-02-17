import { Module, forwardRef } from '@nestjs/common';
import { PhoneCallService } from './phone-call.service';
import { TranscriptionService } from './transcription.service';
import { PrismaModule } from '../prisma.module';
import { MediaModule } from '../media/media.module';
import { TwilioModule } from '../twilio/twilio.module';

@Module({
  imports: [PrismaModule, MediaModule, forwardRef(() => TwilioModule)],
  providers: [PhoneCallService, TranscriptionService],
  exports: [PhoneCallService, TranscriptionService],
})
export class PhoneCallModule {}
