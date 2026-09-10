/**
 * Traduccion de una notificacion del CRM al formato de cada chat.
 *
 * Vive en `common` y no en un modulo concreto porque lo usan dos procesos: la
 * `api` para el envio de prueba —que es lo unico que le dice al tenant si dejo
 * el canal bien configurado— y `data-sync` para el reparto real.
 *
 * Es deliberadamente sin estado y sin dependencias de Nest: son funciones puras
 * mas un `fetch`. Asi el mismo codigo se puede probar sin levantar nada.
 */

export type ChatProvider = 'telegram' | 'discord' | 'slack';

/** Lo que se manda, ya resuelto: viene de una fila de `notifications`. */
export interface ChatPayload {
  title: string;
  message: string;
  /** Tipo de notificacion, p. ej. `CUSTOMER_DEPOSIT`. */
  type: string;
  /** low | normal | high | urgent */
  priority?: string | null;
  /** Ruta o URL a la que lleva la notificacion en el dashboard. */
  actionUrl?: string | null;
}

export interface ChatTarget {
  provider: ChatProvider;
  /** chat_id de Telegram, URL del webhook de Discord o id de canal de Slack. */
  target: string;
  /** Secretos del proveedor. Slack necesita su bot token aqui. */
  credentials?: Record<string, unknown> | null;
}

/** Color del lateral en Discord y Slack, por prioridad. */
const COLOR: Record<string, number> = {
  urgent: 0xdc2626,
  high: 0xea580c,
  normal: 0x2563eb,
  low: 0x6b7280,
};

const EMOJI: Record<string, string> = {
  urgent: '🚨',
  high: '⚠️',
  normal: '🔔',
  low: '💬',
};

function color(priority?: string | null): number {
  return COLOR[(priority ?? 'normal').toLowerCase()] ?? COLOR.normal;
}

function emoji(priority?: string | null): string {
  return EMOJI[(priority ?? 'normal').toLowerCase()] ?? EMOJI.normal;
}

/**
 * Convierte `actionUrl` en algo en lo que se pueda pulsar desde el movil.
 *
 * Las notificaciones guardan rutas relativas (`/dashboard/...`) porque dentro
 * del dashboard eso basta. En un chat no: hace falta la URL entera.
 */
export function absoluteUrl(
  actionUrl: string | null | undefined,
  frontendUrl = process.env.FRONTEND_URL,
): string | null {
  if (!actionUrl) return null;
  if (/^https?:\/\//i.test(actionUrl)) return actionUrl;
  if (!frontendUrl) return null;
  return `${frontendUrl.replace(/\/+$/, '')}/${actionUrl.replace(/^\/+/, '')}`;
}

/** Telegram interpreta HTML, asi que hay que escapar lo que venga del usuario. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Un constructor de cuerpo por proveedor ──────────────────────────────────

function telegramBody(chatId: string, p: ChatPayload) {
  const url = absoluteUrl(p.actionUrl);
  return {
    chat_id: chatId,
    text: `${emoji(p.priority)} <b>${escapeHtml(p.title)}</b>\n${escapeHtml(p.message)}`,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    // Telegram solo admite botones con URL https publica; con el dashboard en
    // local no hay boton, pero el mensaje sigue llegando.
    ...(url && url.startsWith('https://')
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: 'Abrir en el CRM', url }]],
          },
        }
      : {}),
  };
}

function discordBody(p: ChatPayload) {
  const url = absoluteUrl(p.actionUrl);
  return {
    embeds: [
      {
        title: `${emoji(p.priority)} ${p.title}`.slice(0, 256),
        description: p.message.slice(0, 4096),
        color: color(p.priority),
        ...(url ? { url } : {}),
        footer: { text: p.type },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function slackBody(channel: string, p: ChatPayload) {
  const url = absoluteUrl(p.actionUrl);
  return {
    channel,
    text: `${p.title} — ${p.message}`, // respaldo para las notificaciones del movil
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji(p.priority)} *${p.title}*\n${p.message}`,
        },
      },
      ...(url
        ? [
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Abrir en el CRM' },
                  url,
                },
              ],
            },
          ]
        : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: p.type }],
      },
    ],
  };
}

// ── Envio ───────────────────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Entrega un mensaje. Nunca lanza: devuelve el error para que quien llama lo
 * guarde en `lastErrorMsg` y la UI pueda decir que ese canal esta roto.
 */
export async function sendChatMessage(
  target: ChatTarget,
  payload: ChatPayload,
  timeoutMs = 10_000,
): Promise<SendResult> {
  try {
    let url: string;
    let body: unknown;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    switch (target.provider) {
      case 'telegram': {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN no configurado' };
        url = `https://api.telegram.org/bot${token}/sendMessage`;
        body = telegramBody(target.target, payload);
        break;
      }
      case 'discord': {
        url = target.target; // el propio webhook
        body = discordBody(payload);
        break;
      }
      case 'slack': {
        const token = target.credentials?.botToken;
        if (typeof token !== 'string' || !token) {
          return { ok: false, error: 'El canal de Slack no tiene bot token' };
        }
        url = 'https://slack.com/api/chat.postMessage';
        headers.Authorization = `Bearer ${token}`;
        body = slackBody(target.target, payload);
        break;
      }
      default:
        return { ok: false, error: `Proveedor desconocido: ${target.provider}` };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${detail.slice(0, 200)}` };
    }

    // Slack contesta 200 aunque falle; el error real va en el cuerpo.
    if (target.provider === 'slack') {
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (json && json.ok === false) {
        return { ok: false, error: `Slack: ${json.error ?? 'error desconocido'}` };
      }
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  }
}

/**
 * Un canal recibe un tipo si no ha elegido ninguno (quiere todo) o si lo tiene
 * en su lista.
 */
export function channelWantsType(types: string[], type: string): boolean {
  return types.length === 0 || types.includes(type);
}
