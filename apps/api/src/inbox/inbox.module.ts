import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { S3Service } from '@htownautos/common';
import { MediaResolverService, SocialIngestService, SocialTokenService, SocialNotifierService } from '@htownautos/social';
import { SmsModule } from '../sms/sms.module';
import { TwilioModule } from '../twilio/twilio.module';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

/**
 * Unified inbox (`/inbox/**`) — package B3/B5 per
 * docs/social-suite/CONTRACT.md §3.7/§6. `SocialRealtimeService` and
 * `TwilioService` are both `@Global()` (imported once in `app.module.ts`) —
 * not re-listed here as providers, only plain per-module injectables are.
 * `TwilioModule` is still imported for clarity even though it's global.
 */
@Module({
  imports: [PrismaModule, SmsModule, TwilioModule],
  controllers: [InboxController],
  providers: [InboxService, S3Service, MediaResolverService, SocialTokenService, SocialIngestService, SocialNotifierService],
})
export class InboxModule {}
