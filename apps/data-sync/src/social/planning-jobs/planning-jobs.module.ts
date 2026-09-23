import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialFeedsRefreshService } from './feeds-refresh.service';

/**
 * Planning jobs (docs/social-suite/CONTRACT.md §3.5/§4, package B4b): the
 * every-30-min RSS/Atom feed refresh cron. `ScheduleModule.forRoot()` is
 * already registered once in `apps/data-sync/src/app.module.ts`, so `@Cron`
 * inside `SocialFeedsRefreshService` just needs this module in the tree.
 */
@Module({
  imports: [PrismaModule],
  providers: [SocialFeedsRefreshService],
})
export class SocialPlanningJobsModule {}
