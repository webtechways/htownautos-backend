import { Module } from '@nestjs/common';
import { SocialPublisherModule } from './publisher/publisher.module';
import { SocialPlanningJobsModule } from './planning-jobs/planning-jobs.module';
import { SocialInboxJobsModule } from './inbox-jobs/inbox-jobs.module';
import { SocialCommunityJobsModule } from './community-jobs/community-jobs.module';
import { SocialInsightsJobsModule } from './insights-jobs/insights-jobs.module';

/**
 * Root module for the Social Suite's background work in data-sync (§4 of
 * docs/social-suite/CONTRACT.md): publisher, reminders, token refresh, DM
 * pollers, comment pollers, metrics, RSS feeds. Every child is a placeholder
 * — see CONTRACT.md §6 for which package fills each one.
 */
@Module({
  imports: [
    SocialPublisherModule,
    SocialPlanningJobsModule,
    SocialInboxJobsModule,
    SocialCommunityJobsModule,
    SocialInsightsJobsModule,
  ],
})
export class SocialJobsModule {}
