import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { AuctionCalendarModule } from '../auction-calendar/auction-calendar.module';
import { IaaiCalendarModule } from '../iaai-calendar/iaai-calendar.module';
import { CalendarIngestController } from './calendar-ingest.controller';

@Module({
  imports: [PrismaModule, AuctionCalendarModule, IaaiCalendarModule],
  controllers: [CalendarIngestController],
})
export class CalendarIngestModule {}
