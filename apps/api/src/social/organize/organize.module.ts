import { Module } from '@nestjs/common';
import { PrismaModule } from '@htownautos/prisma';
import { SocialMediaModule } from '../media/media.module';
import { SocialTagsController } from './tags.controller';
import { SocialTagsService } from './tags.service';
import { SocialTemplatesController } from './templates.controller';
import { SocialTemplatesService } from './templates.service';
import { SocialHashtagGroupsController } from './hashtag-groups.controller';
import { SocialHashtagGroupsService } from './hashtag-groups.service';
import { SocialIdeaGroupsController } from './idea-groups.controller';
import { SocialIdeaGroupsService } from './idea-groups.service';
import { SocialIdeasController } from './ideas.controller';
import { SocialIdeasService } from './ideas.service';
import { SocialFeedsController } from './feeds.controller';
import { SocialFeedsService } from './feeds.service';
import { SocialAiController } from './ai.controller';
import { SocialAiService } from './ai.service';

/**
 * Tags/templates/hashtag groups/idea board/feeds/AI assistant
 * (docs/social-suite/CONTRACT.md §3.5, package B4b). `SocialMediaModule`
 * gives `MediaResolverService` (already an `@Injectable` with only
 * resolvable deps) for resolving idea media into signed URLs, reusing
 * `resolveMediaMap`/`toUserSummary` from `../posts/mappers` (frozen,
 * B2-owned) rather than duplicating them.
 */
@Module({
  imports: [PrismaModule, SocialMediaModule],
  controllers: [
    SocialTagsController,
    SocialTemplatesController,
    SocialHashtagGroupsController,
    SocialIdeaGroupsController,
    SocialIdeasController,
    SocialFeedsController,
    SocialAiController,
  ],
  providers: [
    SocialTagsService,
    SocialTemplatesService,
    SocialHashtagGroupsService,
    SocialIdeaGroupsService,
    SocialIdeasService,
    SocialFeedsService,
    SocialAiService,
  ],
})
export class SocialOrganizeModule {}
