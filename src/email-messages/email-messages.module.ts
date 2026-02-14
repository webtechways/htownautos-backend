import { Module } from '@nestjs/common';
import { EmailMessagesService } from './email-messages.service';
import { EmailMessagesController } from './email-messages.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [EmailMessagesController],
  providers: [EmailMessagesService, PrismaService],
  exports: [EmailMessagesService],
})
export class EmailMessagesModule {}
