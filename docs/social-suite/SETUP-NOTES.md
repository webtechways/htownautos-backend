# Setup notes (input for the user's app-creation guide)

OAuth redirect URIs (every app): `https://app.htownautos.com/dashboard/settings/integrations`,
`https://dev-app.htownautos.com/dashboard/settings/integrations`.
Meta webhook: `https://api.htownautos.com/api/v1/social/webhooks/meta` (verify token = `META_WEBHOOK_VERIFY_TOKEN`).

Scopes requested by the backend (B2, 2026-09-23):
- Facebook Pages: pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_metadata, pages_messaging, pages_read_user_content, pages_manage_engagement, read_insights, public_profile
- Instagram via FB Login: instagram_basic, instagram_content_publish, instagram_manage_comments, instagram_manage_messages, pages_show_list, pages_read_engagement
- Instagram Login (used when INSTAGRAM_APP_ID/SECRET are set): instagram_business_basic, instagram_business_content_publish, instagram_business_manage_comments, instagram_business_manage_messages
- Threads: threads_basic, threads_content_publish, threads_manage_replies, threads_read_replies
- TikTok: user.info.basic, video.publish, video.upload, video.list
- YouTube: youtube.readonly, youtube.upload, youtube.force-ssl
- Google Business Profile: business.manage
- LinkedIn: openid, profile, w_member_social, r_organization_social, w_organization_social, rw_organization_admin
- Pinterest: boards:read, boards:write, pins:read, pins:write, user_accounts:read
- X (OAuth2 PKCE): tweet.read, tweet.write, users.read, media.write, offline.access
- Mastodon: read, write (app registered per instance automatically)
- Bluesky: app password
- WhatsApp: whatsapp_business_messaging, whatsapp_business_management (+ Embedded Signup config id → VITE_WHATSAPP_CONFIG_ID)

Backend env: FACEBOOK_APP_ID/SECRET, INSTAGRAM_APP_ID/SECRET, THREADS_APP_ID/SECRET, TIKTOK_CLIENT_KEY/SECRET,
YOUTUBE_CLIENT_ID/SECRET (fallback GOOGLE_*), GOOGLE_BUSINESS_CLIENT_ID/SECRET, LINKEDIN_CLIENT_ID/SECRET,
PINTEREST_APP_ID/SECRET, X_CLIENT_ID/SECRET, META_WEBHOOK_VERIFY_TOKEN, META_GRAPH_VERSION (default v23.0),
SOCIAL_TOKEN_KEY (required), OAUTH_STATE_SECRET (required).
Frontend env: VITE_FACEBOOK_APP_ID, VITE_WHATSAPP_CONFIG_ID.

Open follow-ups: X messages/mentions need paid tier; later scopes may be added by inbox/community/insights packages
(e.g. read_insights, instagram_manage_insights, yt-analytics.readonly, threads_manage_insights, dm.read/dm.write).
- LinkedIn org comments need Community Management API partner approval (not just a scope). X mentions need paid tier.
- Insights scopes added (B7): instagram_manage_insights (IG via FB), instagram_business_manage_insights (IG Login), threads_manage_insights, user.info.stats (TikTok); read_insights (FB).
- Meta webhook fields (B5): Page → messages, messaging_postbacks, feed; Instagram → messages, comments, mentions; WhatsApp (WABA) → messages.
