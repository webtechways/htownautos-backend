// Messaging adapters for the unified inbox (package B3/B5) — one per social
// DM channel per docs/social-suite/CONTRACT.md §3.7. SMS/WhatsApp-via-Twilio
// have no adapter here: `SmsService` sends those directly through Twilio.
export * from './types';
export * from './meta-dm.messenger';
export * from './whatsapp.messenger';
export * from './x.messenger';
export * from './bluesky.messenger';
export * from './mastodon.messenger';
export * from './registry';
