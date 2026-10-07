import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { ProxyService } from '@htownautos/common';
import { IaaiCalendarService } from './iaai-calendar.service';
import { IaaiCalendarController } from './iaai-calendar.controller';

// PrismaModule hace falta: ClerkJwtGuard inyecta PrismaService y sin el la api
// entera no arranca. ProxyService descarga iaai.com por el pool de Webshare.
@Module({
  imports: [PrismaModule],
  controllers: [IaaiCalendarController],
  providers: [IaaiCalendarService, ProxyService],
  exports: [IaaiCalendarService],
})
export class IaaiCalendarModule {}
