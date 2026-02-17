import { Module, Global, forwardRef } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { TwilioWebhookController } from './twilio-webhook.controller';
import { TwilioClientController } from './twilio-client.controller';
import { CallFlowModule } from '../call-flow/call-flow.module';
import { PrismaModule } from '../prisma.module';
import { PhoneCallModule } from '../phone-call/phone-call.module';
import { SmsModule } from '../sms/sms.module';

@Global()
@Module({
  imports: [
    CallFlowModule,
    PrismaModule,
    forwardRef(() => PhoneCallModule),
    forwardRef(() => SmsModule),
  ],
  controllers: [TwilioWebhookController, TwilioClientController],
  providers: [TwilioService],
  exports: [TwilioService],
})
export class TwilioModule {}
