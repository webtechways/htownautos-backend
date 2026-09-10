export { RabbitMQModule } from './rabbitmq.module';
export { RabbitMQService } from './rabbitmq.service';
export {
  AUCTION_SYNC_TRIGGER_QUEUE,
  type AuctionSyncTriggerMessage,
} from './auction-sync-trigger';

export {
  CHAT_DISPATCH_QUEUE,
  type ChatDispatchMessage,
} from './chat-dispatch';

export * from './auction-frames';
