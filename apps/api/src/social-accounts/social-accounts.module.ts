import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialTokenService, SocialNotifierService } from '@htownautos/social';
import { SocialAccountsService } from './social-accounts.service';
import { SocialAccountsController } from './social-accounts.controller';

/**
 * `RedisService` and `RabbitMQService` aren't imported here — both
 * `@Global()` modules (`RedisModule`, `RabbitMQModule`) are already imported
 * once in `apps/api/src/app.module.ts`, so their providers resolve anywhere
 * in this process. `SocialTokenService`/`SocialNotifierService` are plain
 * `@Injectable` classes exported from `@htownautos/social` (no module of
 * their own), so they're listed here directly.
 */
@Module({
  imports: [PrismaModule],
  controllers: [SocialAccountsController],
  providers: [SocialAccountsService, SocialTokenService, SocialNotifierService],
  exports: [SocialAccountsService, SocialTokenService],
})
export class SocialAccountsModule {}
