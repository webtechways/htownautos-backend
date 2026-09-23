import { socialFetch, SocialApiError } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import { MessagingError } from './types';
import type { SendMessageParams, SendMessageOutcome, SocialMessenger, WindowInfo } from './types';

const WINDOW_MS = 24 * 60 * 60 * 1000;
const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function windowInfoFor(lastInboundAt: Date | null, supportsHumanAgentTag: boolean): WindowInfo {
  if (!lastInboundAt) return { canReply: false, windowExpiresAt: null, replyRequiresTemplate: false };
  const expiresAt = new Date(lastInboundAt.getTime() + WINDOW_MS);
  const withinWindow = expiresAt.getTime() > Date.now();
  const withinHumanAgent = supportsHumanAgentTag && lastInboundAt.getTime() + HUMAN_AGENT_WINDOW_MS > Date.now();
  return {
    canReply: withinWindow || withinHumanAgent,
    windowExpiresAt: expiresAt.toISOString(),
    replyRequiresTemplate: false,
  };
}

async function sendAttachment(accessToken: string, recipientId: string, url: string, kind: 'image' | 'video' | 'file'): Promise<{ message_id: string }> {
  const attachmentType = kind === 'file' ? 'file' : kind;
  const res = await socialFetch(graphUrl(`/me/messages?access_token=${encodeURIComponent(accessToken)}`), {
    platform: 'facebook',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { attachment: { type: attachmentType, payload: { url, is_reusable: true } } },
      messaging_type: 'RESPONSE',
    }),
  });
  return (await res.json()) as { message_id: string };
}

/**
 * Shared Meta Send API implementation for Messenger and Instagram DMs. The
 * access token belongs to the page (Messenger) or IG-connected page
 * (Instagram) — Graph resolves `/me/messages` from it, so both channels hit
 * the same endpoint. `supportsHumanAgentTag`: Messenger can extend replies
 * to 7 days with `messaging_type: MESSAGE_TAG, tag: HUMAN_AGENT`; Instagram
 * has no such extension (strict 24h).
 */
function createMetaDmMessenger(platform: 'facebook' | 'instagram', supportsHumanAgentTag: boolean): SocialMessenger {
  return {
    windowInfo: (lastInboundAt) => windowInfoFor(lastInboundAt, supportsHumanAgentTag),

    async send(params: SendMessageParams): Promise<SendMessageOutcome> {
      const { ctx, recipientExternalId, text, media, lastInboundAt } = params;
      const info = windowInfoFor(lastInboundAt, supportsHumanAgentTag);
      if (!info.canReply) {
        throw new MessagingError('WINDOW_CLOSED', 'La ventana de 24 horas para responder este mensaje ya cerró.');
      }
      const useHumanAgentTag = lastInboundAt ? lastInboundAt.getTime() + WINDOW_MS <= Date.now() : false;

      let lastMessageId: string | null = null;

      if (text) {
        const res = await socialFetch(graphUrl(`/me/messages?access_token=${encodeURIComponent(ctx.accessToken)}`), {
          platform,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: recipientExternalId },
            message: { text },
            ...(useHumanAgentTag ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : { messaging_type: 'RESPONSE' }),
          }),
        });
        const data = (await res.json()) as { message_id: string };
        lastMessageId = data.message_id;
      }

      for (const item of media ?? []) {
        const url = await ctx.resolver.signedUrl(item);
        const kind = item.kind === 'video' ? 'video' : item.kind === 'document' ? 'file' : 'image';
        const data = await sendAttachment(ctx.accessToken, recipientExternalId, url, kind);
        lastMessageId = data.message_id;
      }

      if (!lastMessageId) {
        throw new SocialApiError({ platform, httpStatus: 0, kind: 'VALIDATION', message: 'Nada que enviar: falta texto o medios' });
      }
      return { externalId: lastMessageId, status: 'sent' };
    },
  };
}

export const messengerMessenger: SocialMessenger = createMetaDmMessenger('facebook', true);
export const instagramMessenger: SocialMessenger = createMetaDmMessenger('instagram', false);
