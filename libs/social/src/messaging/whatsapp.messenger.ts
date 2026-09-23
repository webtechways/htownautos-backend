import { socialFetch, SocialApiError } from '../http/social-http';
import { graphUrl } from '../connect/meta-graph';
import { MessagingError } from './types';
import type {
  MessagingContext,
  SendMessageParams,
  SendMessageOutcome,
  SocialMessenger,
  WindowInfo,
  WhatsAppTemplateView,
} from './types';

const WINDOW_MS = 24 * 60 * 60 * 1000;

function windowInfoFor(lastInboundAt: Date | null): WindowInfo {
  if (!lastInboundAt) return { canReply: false, windowExpiresAt: null, replyRequiresTemplate: true };
  const expiresAt = new Date(lastInboundAt.getTime() + WINDOW_MS);
  const canReply = expiresAt.getTime() > Date.now();
  return { canReply: true, windowExpiresAt: expiresAt.toISOString(), replyRequiresTemplate: !canReply };
}

function phoneNumberId(ctx: MessagingContext): string {
  const id = (ctx.secrets.phoneNumberId as string | undefined) ?? ctx.account.platformAccountId;
  if (!id) throw new SocialApiError({ platform: 'whatsapp', httpStatus: 0, kind: 'NOT_CONFIGURED', message: 'Cuenta de WhatsApp sin phone_number_id' });
  return id;
}

function wabaId(ctx: MessagingContext): string {
  const id = ctx.secrets.wabaId as string | undefined;
  if (!id) throw new SocialApiError({ platform: 'whatsapp', httpStatus: 0, kind: 'NOT_CONFIGURED', message: 'Cuenta de WhatsApp sin waba_id' });
  return id;
}

async function post(ctx: MessagingContext, body: Record<string, unknown>): Promise<{ messages: { id: string }[] }> {
  const res = await socialFetch(graphUrl(`/${phoneNumberId(ctx)}/messages`), {
    platform: 'whatsapp',
    method: 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...body }),
  });
  return (await res.json()) as { messages: { id: string }[] };
}

function mediaTypeFor(mimeType: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export const whatsappMessenger: SocialMessenger = {
  windowInfo: windowInfoFor,

  async send(params: SendMessageParams): Promise<SendMessageOutcome> {
    const { ctx, recipientExternalId, text, media, template, lastInboundAt } = params;

    if (template) {
      const data = await post(ctx, {
        to: recipientExternalId,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language },
          ...(template.variables.length > 0
            ? { components: [{ type: 'body', parameters: template.variables.map((text) => ({ type: 'text', text })) }] }
            : {}),
        },
      });
      return { externalId: data.messages[0].id, status: 'sent' };
    }

    const info = windowInfoFor(lastInboundAt);
    if (info.replyRequiresTemplate) {
      throw new MessagingError('TEMPLATE_REQUIRED', 'La ventana de servicio al cliente de 24 horas cerró — se requiere una plantilla aprobada.');
    }

    let lastMessageId: string | null = null;

    if (text) {
      const data = await post(ctx, { to: recipientExternalId, type: 'text', text: { body: text } });
      lastMessageId = data.messages[0].id;
    }

    for (const item of media ?? []) {
      const url = await ctx.resolver.signedUrl(item);
      const type = mediaTypeFor(item.mimeType);
      const data = await post(ctx, { to: recipientExternalId, type, [type]: { link: url } });
      lastMessageId = data.messages[0].id;
    }

    if (!lastMessageId) {
      throw new SocialApiError({ platform: 'whatsapp', httpStatus: 0, kind: 'VALIDATION', message: 'Nada que enviar: falta texto o medios' });
    }
    return { externalId: lastMessageId, status: 'sent' };
  },

  async listTemplates(ctx: MessagingContext): Promise<WhatsAppTemplateView[]> {
    const url = new URL(graphUrl(`/${wabaId(ctx)}/message_templates`));
    url.searchParams.set('fields', 'name,language,category,status,components');
    url.searchParams.set('limit', '100');
    const res = await socialFetch(url.toString(), { platform: 'whatsapp', headers: { Authorization: `Bearer ${ctx.accessToken}` } });
    const data = (await res.json()) as {
      data: Array<{ name: string; language: string; category: string; status: string; components: Array<{ type: string; text?: string }> }>;
    };
    return data.data.map((t) => {
      const body = t.components.find((c) => c.type === 'BODY');
      const bodyText = body?.text ?? '';
      const variableCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
      return { name: t.name, language: t.language, category: t.category, status: t.status, bodyText, variableCount };
    });
  },
};
