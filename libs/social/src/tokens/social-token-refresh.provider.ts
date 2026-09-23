import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { RabbitMQService } from '@htownautos/rabbitmq';
import { SocialRealtimeService } from '../realtime/social-realtime.service';
import { SocialNotifierService } from '../notify/social-notifier';
import { SocialTokenService } from './social-token.service';

/** CONTRACT.md §4 "Token refresh": hourly, refresh what expires in < 72h. */
const REFRESH_WINDOW_HOURS = 72;

/**
 * Hourly cron for the Social Suite's token refresh job. Deliberately built
 * as a single self-contained provider — the package that owns
 * `apps/data-sync/src/social/publisher.module.ts` (B2b/publisher) only takes
 * one extra line in its `providers` array for this. `PrismaService` resolves
 * via that module's existing `PrismaModule` import; `RabbitMQService` and
 * `SocialRealtimeService` are both `@Global()` (imported once in
 * `apps/data-sync/src/app.module.ts`), so all three constructor params are
 * already resolvable without touching any other registration. `SocialTokenService`
 * and `SocialNotifierService` aren't registered as providers anywhere in
 * data-sync, so they're constructed directly here rather than injected.
 */
@Injectable()
export class SocialTokenRefreshProvider {
  private readonly logger = new Logger(SocialTokenRefreshProvider.name);
  private readonly tokenService: SocialTokenService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly realtime: SocialRealtimeService,
  ) {
    const notifier = new SocialNotifierService(this.prisma, this.rabbitMQ);
    this.tokenService = new SocialTokenService(this.prisma, notifier, this.realtime);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    const { refreshed, failed } = await this.tokenService.refreshExpiring(REFRESH_WINDOW_HOURS);
    if (refreshed || failed) {
      this.logger.log(`Social token refresh: ${refreshed} ok, ${failed} failed`);
    }
  }
}
