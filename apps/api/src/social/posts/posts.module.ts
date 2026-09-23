import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialNotifierService } from '@htownautos/social';
import { SocialSettingsModule } from '../settings/social-settings.module';
import { SocialMediaModule } from '../media/media.module';
import { SocialPostsController } from './posts.controller';
import { SocialPostsService } from './posts.service';
import { SocialQueueController } from './queue.controller';
import { SocialQueueService } from './queue.service';
import { SocialSchedulesController } from './schedules.controller';
import { SocialSchedulesService } from './schedules.service';
import { SocialGoalsController } from './goals.controller';
import { SocialGoalsService } from './goals.service';
import { SocialHomeController } from './home.controller';
import { SocialHomeService } from './home.service';
import { SocialSchedulingService } from './scheduling.service';

/**
 * Posts + queue + approvals + posting schedules + goals + home
 * (docs/social-suite/CONTRACT.md §3.3/§3.4). `SocialSettingsModule` gives
 * `SocialAccessService` (isAdmin/getSettings); `SocialMediaModule` gives
 * `MediaResolverService` (both already `@Injectable`s with only resolvable
 * deps — no unresolvable constructor params, per this repo's anti-pattern
 * list). `RabbitMQService`/`SocialRealtimeService` are `@Global()` singletons
 * (registered once in `app.module.ts`), so they're injected directly below
 * without appearing in `imports`.
 */
@Module({
  imports: [PrismaModule, SocialSettingsModule, SocialMediaModule],
  controllers: [SocialPostsController, SocialQueueController, SocialSchedulesController, SocialGoalsController, SocialHomeController],
  providers: [SocialPostsService, SocialQueueService, SocialSchedulesService, SocialGoalsService, SocialHomeService, SocialSchedulingService, SocialNotifierService],
})
export class SocialPostsModule {}
