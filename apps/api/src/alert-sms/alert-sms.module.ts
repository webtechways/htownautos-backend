import { Module } from '@nestjs/common';
import { AlertSmsController } from './alert-sms.controller';

/** TwilioService comes from the global TwilioModule. */
@Module({ controllers: [AlertSmsController] })
export class AlertSmsModule {}
