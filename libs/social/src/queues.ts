/**
 * RabbitMQ queue names + message shapes for the Social Suite. Consumed the
 * same way as existing queues (`RabbitMQService.publish` / `.consume`, see
 * `@htownautos/rabbitmq`) — declared here rather than in libs/rabbitmq
 * because they're specific to this suite, mirroring how
 * `apps/data-sync/src/chat-dispatch.consumer.ts` keeps `CHAT_DISPATCH_QUEUE`
 * usage local instead of growing the shared queue registry.
 */

/** data-sync's publisher job listens here for "publish now" requests from the api. */
export const SOCIAL_PUBLISH_QUEUE = 'social.publish';

export interface SocialPublishMessage {
  targetIds: string[];
}

/**
 * data-sync has no Socket.IO server — it publishes realtime events here so
 * the api's bridge (see `SocialRealtimeService`) can re-emit them to
 * `tenant:<id>` rooms.
 */
export const SOCIAL_REALTIME_QUEUE = 'social.realtime';

export interface SocialRealtimeQueueMessage {
  tenantId: string;
  event: string;
  payload: unknown;
}
