import { Module, Global } from '@nestjs/common';
import { TwilioService } from './twilio.service';
import { TwilioWebhookController } from './twilio-webhook.controller';
import { TwilioClientController } from './twilio-client.controller';
import { CallFlowModule } from '../call-flow/call-flow.module';
import { PrismaModule } from '../prisma.module';

@Global()
@Module({
  imports: [CallFlowModule, PrismaModule],
  controllers: [TwilioWebhookController, TwilioClientController],
  providers: [TwilioService],
  exports: [TwilioService],
})
export class TwilioModule {}
