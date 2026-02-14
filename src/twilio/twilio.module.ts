import { Module, Global } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { TwilioWebhookController } from './twilio-webhook.controller';
import { CallFlowModule } from '../call-flow/call-flow.module';

@Global()
@Module({
  imports: [CallFlowModule],
  controllers: [TwilioWebhookController],
  providers: [TwilioService],
  exports: [TwilioService],
})
export class TwilioModule {}
