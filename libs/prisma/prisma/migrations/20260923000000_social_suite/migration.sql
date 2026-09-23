-- Social Suite (Buffer clone + unified inbox) — paquete B1 (Foundation).
--
-- Que hace: agrega columnas nuevas a social_accounts (accountType, publishMethod,
-- status, profileUrl, encryptedSecrets, webhookSubscribedAt), vuelve nullable
-- sms_messages.buyerId (un SMS entrante de un numero no vinculado a un Buyer ya
-- no se descarta, se guarda sin dueno), agrega short_urls.socialPostTargetId, y
-- crea 19 tablas nuevas: calendario/metas/config de publicacion, libreria de
-- medios, posts + sus targets por canal, organizacion (tags/plantillas/hashtags/
-- ideas/feeds RSS), comentarios normalizados, metricas diarias, start pages
-- ("link in bio") y la bandeja unificada (conversaciones + mensajes).
--
-- Idempotente: CREATE TABLE/INDEX ... IF NOT EXISTS, ADD COLUMN IF NOT EXISTS,
-- FKs envueltas en DO $$ ... EXCEPTION WHEN duplicate_object. Sin DROP de nada
-- que ya existiera. Puede reintentarse sin romper si un deploy anterior quedo
-- a medias.
--
-- Rollback: no hay uno automatico (crear tablas nunca lo tiene). Si hiciera
-- falta deshacerla, es DROP TABLE de las 19 tablas nuevas (en orden inverso de
-- FKs) + revertir sms_messages.buyerId a NOT NULL (requiere antes backfillear
-- o borrar las filas que hayan quedado con buyerId null) + quitar las columnas
-- agregadas a social_accounts y short_urls. Ninguna tabla existente pierde
-- datos con esta migracion.

-- DropForeignKey
ALTER TABLE "sms_messages" DROP CONSTRAINT IF EXISTS "sms_messages_buyerId_fkey";

-- AlterTable
ALTER TABLE "sms_messages" ALTER COLUMN "buyerId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "short_urls" ADD COLUMN IF NOT EXISTS "socialPostTargetId" TEXT;

-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN IF NOT EXISTS "accountType" TEXT,
ADD COLUMN IF NOT EXISTS "encryptedSecrets" TEXT,
ADD COLUMN IF NOT EXISTS "profileUrl" TEXT,
ADD COLUMN IF NOT EXISTS "publishMethod" TEXT NOT NULL DEFAULT 'api',
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS "webhookSubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_posting_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "slots" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posting_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_goals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "postsPerWeek" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "shortenLinks" BOOLEAN NOT NULL DEFAULT false,
    "utmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "utmSource" TEXT,
    "utmMedium" TEXT NOT NULL DEFAULT 'social',
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_media" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "altText" TEXT,
    "thumbnailKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_posts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" TEXT NOT NULL,
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scheduleMode" TEXT NOT NULL DEFAULT 'draft',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "ideaId" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_post_targets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "content" TEXT,
    "mediaOverride" JSONB,
    "options" JSONB NOT NULL DEFAULT '{}',
    "thread" JSONB NOT NULL DEFAULT '[]',
    "firstComment" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "slotted" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "externalUrl" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "metrics" JSONB,
    "metricsUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_post_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_tags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366F1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_hashtag_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashtags" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_hashtag_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_idea_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_idea_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_ideas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceUrl" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_feeds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "siteUrl" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_feed_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "summary" TEXT,
    "imageUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_feed_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_comments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "externalId" TEXT NOT NULL,
    "parentId" TEXT,
    "externalParentId" TEXT,
    "externalPostId" TEXT,
    "postTargetId" TEXT,
    "postPreview" JSONB,
    "authorName" TEXT NOT NULL,
    "authorHandle" TEXT,
    "authorAvatarUrl" TEXT,
    "authorExternalId" TEXT,
    "body" TEXT NOT NULL,
    "permalink" TEXT,
    "rating" INTEGER,
    "fromUs" BOOLEAN NOT NULL DEFAULT false,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "likedByUs" BOOLEAN NOT NULL DEFAULT false,
    "repliedAt" TIMESTAMP(3),
    "platformCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_account_metrics_daily" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER,
    "impressions" INTEGER,
    "reach" INTEGER,
    "engagements" INTEGER,
    "profileViews" INTEGER,
    "videoViews" INTEGER,
    "clicks" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_account_metrics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_start_pages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bio" TEXT,
    "avatarMediaId" TEXT,
    "theme" JSONB NOT NULL DEFAULT '{}',
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_start_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "social_start_page_stats" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "blockId" TEXT NOT NULL DEFAULT '',
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_start_page_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inbox_conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "senderKind" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL,
    "socialAccountId" TEXT,
    "twilioPhoneNumberId" TEXT,
    "contactExternalId" TEXT NOT NULL,
    "contactName" TEXT,
    "contactHandle" TEXT,
    "contactPhone" TEXT,
    "contactAvatarUrl" TEXT,
    "buyerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToId" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "lastDirection" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inbox_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "externalId" TEXT,
    "smsMessageId" TEXT,
    "platformCreatedAt" TIMESTAMP(3) NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_SocialPostToSocialTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SocialPostToSocialTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "_SocialIdeaToSocialTag" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SocialIdeaToSocialTag_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_posting_schedules_accountId_key" ON "social_posting_schedules"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_posting_schedules_tenantId_idx" ON "social_posting_schedules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_goals_accountId_key" ON "social_goals"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_goals_tenantId_idx" ON "social_goals"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_settings_tenantId_key" ON "social_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_media_key_key" ON "social_media"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_media_tenantId_idx" ON "social_media"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_posts_tenantId_idx" ON "social_posts"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_posts_tenantId_status_idx" ON "social_posts"("tenantId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_post_targets_status_scheduledAt_idx" ON "social_post_targets"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_post_targets_tenantId_accountId_scheduledAt_idx" ON "social_post_targets"("tenantId", "accountId", "scheduledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_tags_tenantId_idx" ON "social_tags"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_tags_tenantId_name_key" ON "social_tags"("tenantId", "name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_templates_tenantId_idx" ON "social_templates"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_hashtag_groups_tenantId_idx" ON "social_hashtag_groups"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_idea_groups_tenantId_idx" ON "social_idea_groups"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_ideas_tenantId_idx" ON "social_ideas"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_ideas_tenantId_groupId_idx" ON "social_ideas"("tenantId", "groupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_feeds_tenantId_idx" ON "social_feeds"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_feeds_tenantId_url_key" ON "social_feeds"("tenantId", "url");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_feed_items_tenantId_idx" ON "social_feed_items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_feed_items_feedId_guid_key" ON "social_feed_items"("feedId", "guid");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_comments_tenantId_kind_status_platformCreatedAt_idx" ON "social_comments"("tenantId", "kind", "status", "platformCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_comments_accountId_externalId_key" ON "social_comments"("accountId", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_account_metrics_daily_tenantId_idx" ON "social_account_metrics_daily"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_account_metrics_daily_accountId_date_key" ON "social_account_metrics_daily"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_start_pages_slug_key" ON "social_start_pages"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_start_pages_tenantId_idx" ON "social_start_pages"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "social_start_page_stats_tenantId_idx" ON "social_start_page_stats"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "social_start_page_stats_pageId_date_blockId_key" ON "social_start_page_stats"("pageId", "date", "blockId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbox_conversations_tenantId_status_lastMessageAt_idx" ON "inbox_conversations"("tenantId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbox_conversations_assignedToId_idx" ON "inbox_conversations"("assignedToId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbox_conversations_buyerId_idx" ON "inbox_conversations"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_conversations_tenantId_channel_senderKey_contactExter_key" ON "inbox_conversations"("tenantId", "channel", "senderKey", "contactExternalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_messages_smsMessageId_key" ON "inbox_messages"("smsMessageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbox_messages_tenantId_idx" ON "inbox_messages"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inbox_messages_conversationId_idx" ON "inbox_messages"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_messages_channel_externalId_key" ON "inbox_messages"("channel", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "_SocialPostToSocialTag_B_index" ON "_SocialPostToSocialTag"("B");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "_SocialIdeaToSocialTag_B_index" ON "_SocialIdeaToSocialTag"("B");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "short_urls_socialPostTargetId_idx" ON "short_urls"("socialPostTargetId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_posting_schedules" ADD CONSTRAINT "social_posting_schedules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_posting_schedules" ADD CONSTRAINT "social_posting_schedules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_goals" ADD CONSTRAINT "social_goals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_goals" ADD CONSTRAINT "social_goals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_settings" ADD CONSTRAINT "social_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_media" ADD CONSTRAINT "social_media_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_media" ADD CONSTRAINT "social_media_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "social_ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_postId_fkey" FOREIGN KEY ("postId") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_post_targets" ADD CONSTRAINT "social_post_targets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_tags" ADD CONSTRAINT "social_tags_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_templates" ADD CONSTRAINT "social_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_hashtag_groups" ADD CONSTRAINT "social_hashtag_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_idea_groups" ADD CONSTRAINT "social_idea_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_ideas" ADD CONSTRAINT "social_ideas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_ideas" ADD CONSTRAINT "social_ideas_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "social_idea_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_ideas" ADD CONSTRAINT "social_ideas_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_feeds" ADD CONSTRAINT "social_feeds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_feed_items" ADD CONSTRAINT "social_feed_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_feed_items" ADD CONSTRAINT "social_feed_items_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "social_feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "social_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "social_post_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_account_metrics_daily" ADD CONSTRAINT "social_account_metrics_daily_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_account_metrics_daily" ADD CONSTRAINT "social_account_metrics_daily_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_start_pages" ADD CONSTRAINT "social_start_pages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_start_page_stats" ADD CONSTRAINT "social_start_page_stats_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "social_start_page_stats" ADD CONSTRAINT "social_start_page_stats_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "social_start_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_twilioPhoneNumberId_fkey" FOREIGN KEY ("twilioPhoneNumberId") REFERENCES "twilio_phone_numbers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_conversations" ADD CONSTRAINT "inbox_conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "inbox_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "tenant_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_smsMessageId_fkey" FOREIGN KEY ("smsMessageId") REFERENCES "sms_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "_SocialPostToSocialTag" ADD CONSTRAINT "_SocialPostToSocialTag_A_fkey" FOREIGN KEY ("A") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "_SocialPostToSocialTag" ADD CONSTRAINT "_SocialPostToSocialTag_B_fkey" FOREIGN KEY ("B") REFERENCES "social_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "_SocialIdeaToSocialTag" ADD CONSTRAINT "_SocialIdeaToSocialTag_A_fkey" FOREIGN KEY ("A") REFERENCES "social_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "_SocialIdeaToSocialTag" ADD CONSTRAINT "_SocialIdeaToSocialTag_B_fkey" FOREIGN KEY ("B") REFERENCES "social_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
