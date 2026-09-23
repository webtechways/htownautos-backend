import type { InboxConversation, InboxMessage, TenantUser, User } from '@prisma/client';
import { MediaResolverService } from '@htownautos/social';
import type { InboxChannel, InboxProvider, WindowInfo } from '@htownautos/social';
import { toUserSummary, type UserSummaryView } from '../social/posts/mappers';

/** Internal-only shape stored in `InboxMessage.attachments` — `key` (S3 key, private bucket) instead of the contract's `url`, resolved to a fresh signed URL at read time by `toInboxMessageView`. */
interface StoredAttachment {
  kind: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'location';
  key?: string | null;
  url?: string | null;
  mimeType: string | null;
  name: string | null;
}

export interface InboxAttachmentView {
  kind: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'location';
  url: string;
  mimeType: string | null;
  name: string | null;
}

export interface InboxMessageView {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  body: string | null;
  attachments: InboxAttachmentView[];
  status: string;
  error: string | null;
  sentBy: UserSummaryView | null;
  externalId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface InboxConversationView {
  id: string;
  channel: InboxChannel;
  provider: InboxProvider;
  sender: { kind: 'twilio_number' | 'social_account'; id: string; label: string };
  contact: { name: string | null; handle: string | null; phone: string | null; avatarUrl: string | null; externalId: string };
  buyer: { id: string; name: string } | null;
  status: 'open' | 'done';
  assignedTo: UserSummaryView | null;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastDirection: 'inbound' | 'outbound' | null;
  canReply: boolean;
  windowExpiresAt: string | null;
  replyRequiresTemplate: boolean;
  createdAt: string;
}

type TenantUserWithUser = TenantUser & { user: Pick<User, 'id' | 'name' | 'email' | 'avatar'> };

/** Resolves each attachment's renderable URL: a stored S3 key (private bucket, our own copies) gets a fresh signed GET; a stored `url` (pass-through from the platform's own CDN — Messenger/IG/X/Bluesky attachments) is used as-is. */
export async function toInboxMessageView(message: InboxMessage, resolver: MediaResolverService, sentBy: TenantUserWithUser | null | undefined): Promise<InboxMessageView> {
  const stored = Array.isArray(message.attachments) ? (message.attachments as unknown as StoredAttachment[]) : [];
  const attachments = await Promise.all(
    stored.map(async (a): Promise<InboxAttachmentView> => ({
      kind: a.kind,
      url: a.key ? await resolver.signedUrl(a.key) : (a.url ?? ''),
      mimeType: a.mimeType,
      name: a.name,
    })),
  );

  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction as 'inbound' | 'outbound',
    body: message.body,
    attachments,
    status: message.status,
    error: message.error,
    sentBy: toUserSummary(sentBy),
    externalId: message.externalId,
    createdAt: message.platformCreatedAt.toISOString(),
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    readAt: message.readAt?.toISOString() ?? null,
  };
}

export function toInboxConversationView(
  conversation: InboxConversation,
  senderLabel: string,
  assignedTo: TenantUserWithUser | null | undefined,
  buyer: { id: string; firstName: string; lastName: string } | null | undefined,
  window: WindowInfo,
): InboxConversationView {
  return {
    id: conversation.id,
    channel: conversation.channel as InboxChannel,
    provider: conversation.provider as InboxProvider,
    sender: {
      kind: conversation.senderKind as 'twilio_number' | 'social_account',
      id: conversation.senderKey,
      label: senderLabel,
    },
    contact: {
      name: conversation.contactName,
      handle: conversation.contactHandle,
      phone: conversation.contactPhone,
      avatarUrl: conversation.contactAvatarUrl,
      externalId: conversation.contactExternalId,
    },
    buyer: buyer ? { id: buyer.id, name: `${buyer.firstName} ${buyer.lastName}`.trim() } : null,
    status: conversation.status as 'open' | 'done',
    assignedTo: toUserSummary(assignedTo),
    unreadCount: conversation.unreadCount,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: conversation.lastMessagePreview,
    lastDirection: (conversation.lastDirection as 'inbound' | 'outbound' | null) ?? null,
    canReply: window.canReply,
    windowExpiresAt: window.windowExpiresAt,
    replyRequiresTemplate: window.replyRequiresTemplate,
    createdAt: conversation.createdAt.toISOString(),
  };
}
