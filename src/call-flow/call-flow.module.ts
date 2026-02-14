import { Module, Global } from '@nestjs/common';
import { CallFlowService } from './call-flow.service';
import { TwimlGeneratorService } from './twiml-generator.service';
import { CallFlowController, PhoneNumberCallFlowController } from './call-flow.controller';
import { PrismaModule } from '../prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [CallFlowController, PhoneNumberCallFlowController],
  providers: [CallFlowService, TwimlGeneratorService],
  exports: [CallFlowService, TwimlGeneratorService],
})
export class CallFlowModule {}
