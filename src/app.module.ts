import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { VehicleYearModule } from './vehicle-year/vehicle-year.module';
import { VehicleMakeModule } from './vehicle-make/vehicle-make.module';
import { VehicleModelModule } from './vehicle-model/vehicle-model.module';
import { VehicleTrimModule } from './vehicle-trim/vehicle-trim.module';
import { NomenclatorsModule } from './nomenclators/nomenclators.module';
import { ExtraExpenseModule } from './extra-expense/extra-expense.module';
import { MediaModule } from './media/media.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { AuditModule } from './common/audit.module';
import { MetaModule } from './meta/meta.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { TenantModule } from './tenant/tenant.module';
import { PartsModule } from './parts/parts.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { TitleModule } from './title/title.module';
import { MarketCheckModule } from './marketcheck/marketcheck.module';
import { UploadSessionModule } from './upload-session/upload-session.module';
import { CopartModule } from './copart/copart.module';
import { FavoritesModule } from './favorites/favorites.module';
import { BuyersModule } from './buyers/buyers.module';
import { EmailModule } from './email/email.module';
import { TasksModule } from './tasks/tasks.module';
import { NotesModule } from './notes/notes.module';
import { PhoneCallsModule } from './phone-calls/phone-calls.module';
import { SmsModule } from './sms/sms.module';
import { EmailMessagesModule } from './email-messages/email-messages.module';
import { RedisModule } from './redis/redis.module';
import { PresenceModule } from './presence/presence.module';
import { TwilioModule } from './twilio/twilio.module';
import { CallFlowModule } from './call-flow/call-flow.module';
import { TtsModule } from './tts/tts.module';

/**
 * App Module con seguridad RouteOne/DealerTrack
 * - Rate limiting global
 * - Audit logging
 * - Input validation
 */
@Module({
  imports: [
    // Rate Limiting - Protección DDoS requerida por RouteOne/DealerTrack
    ThrottlerModule.forRoot([
      {
        name: 'short', // Límite corto para prevenir abuso
        ttl: 1000, // 1 segundo
        limit: 300, // 300 requests por segundo
      },
      {
        name: 'medium', // Límite medio
        ttl: 60000, // 1 minuto
        limit: 300, // 300 requests por minuto
      },
      {
        name: 'long', // Límite largo
        ttl: 3600000, // 1 hora
        limit: 5000, // 5000 requests por hora
      },
    ]),

    // Cron jobs
    ScheduleModule.forRoot(),

    // Módulos de infraestructura
    PrismaModule,
    RedisModule, // Global Redis connection
    AuditModule, // Global audit logging for RouteOne/DealerTrack compliance
    EmailModule, // SES email service
    PresenceModule, // User presence tracking
    TwilioModule, // Twilio phone number management
    CallFlowModule, // IVR call flow builder
    TtsModule, // OpenAI TTS audio generation

    // Módulos de negocio
    VehicleYearModule,
    VehicleMakeModule,
    VehicleModelModule,
    VehicleTrimModule,
    VehicleModule,
    NomenclatorsModule,
    ExtraExpenseModule,
    MediaModule,
    MetaModule,
    AuthModule,
    RolesModule,
    TenantModule,
    PartsModule,
    TitleModule,
    AuditLogModule,
    MarketCheckModule,
    UploadSessionModule,
    CopartModule,
    FavoritesModule,
    BuyersModule,
    TasksModule,
    NotesModule,
    PhoneCallsModule,
    SmsModule,
    EmailMessagesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Rate limiting global guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule { }
