import type { SocialAccount, SocialMedia } from '@prisma/client';
import type { MediaResolverService } from '../media/media-resolver.service';
import type { SocialAccountSecrets } from '../connect/types';

/** Mirrors contract.ts `SendMessageRequest['template']` shape. */
export interface OutboundTemplate {
  name: string;
  language: string;
  variables: string[];
}

/**
 * 422 error codes a messaging adapter raises — the inbox controller maps
 * these 1:1 onto `{ code }` per docs/social-suite/CONTRACT.md §3.7.
 */
export type MessagingErrorCode = 'WINDOW_CLOSED' | 'TEMPLATE_REQUIRED' | 'NOT_SUPPORTED';

export class MessagingError extends Error {
  readonly code: MessagingErrorCode;
  constructor(code: MessagingErrorCode, message: string) {
    super(message);
    this.name = 'MessagingError';
    this.code = code;
  }
}

/** Everything a channel adapter needs to send — built once per send by the caller (inbox service / webhook echo handler). */
export interface MessagingContext {
  tenantId: string;
  account: SocialAccount;
  /** Live, non-expired token — already refreshed by `SocialTokenService.getAccessToken`. Unused for channels with no OAuth token (n/a here — every messaging channel is a SocialAccount). */
  accessToken: string;
  secrets: SocialAccountSecrets;
  resolver: MediaResolverService;
}

export interface SendMessageParams {
  ctx: MessagingContext;
  /** `InboxConversation.contactExternalId` — the platform's id for the other party (PSID, IGSID, WhatsApp E.164, X user id, Bluesky DID, Mastodon handle/account id). */
  recipientExternalId: string;
  text?: string;
  media?: SocialMedia[];
  template?: OutboundTemplate;
  /** `InboxConversation.lastInboundAt` — used to compute the 24h/7d messaging window. */
  lastInboundAt: Date | null;
}

export interface SendMessageOutcome {
  externalId: string;
  status: 'sent' | 'queued';
}

export interface WindowInfo {
  canReply: boolean;
  windowExpiresAt: string | null;
  replyRequiresTemplate: boolean;
}

export interface WhatsAppTemplateView {
  name: string;
  language: string;
  category: string;
  status: string;
  bodyText: string;
  variableCount: number;
}

export interface SocialMessenger {
  send(params: SendMessageParams): Promise<SendMessageOutcome>;
  /** Conversation-view info per contract's `canReply`/`windowExpiresAt`/`replyRequiresTemplate`. Channels with no time window (X, Bluesky, Mastodon) always return `canReply: true`. */
  windowInfo(lastInboundAt: Date | null): WindowInfo;
  listTemplates?(ctx: MessagingContext): Promise<WhatsAppTemplateView[]>;
}
