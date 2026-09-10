import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { sendChatMessage, type ChatProvider } from '@htownautos/common';
import { randomBytes } from 'node:crypto';
import type { CreateChannelDto, UpdateChannelDto } from './dto';

/** Cuanto vive un codigo de emparejamiento de Telegram. */
const LINK_CODE_TTL_MS = 15 * 60_000;

/**
 * Canales de chat a los que un tenant reenvia sus notificaciones.
 *
 * Cada proveedor se conecta de forma distinta, y esa diferencia es lo que
 * gobierna el diseño de este servicio:
 *
 * - **Discord**: el tenant pega la URL de un webhook. No hace falta app global.
 * - **Telegram**: un unico bot tuyo. El tenant recibe un codigo, se lo manda al
 *   bot y el webhook lo canjea por el `chat_id`. Nunca se le pide un secreto,
 *   que es la regla de la casa para integraciones.
 * - **Slack**: OAuth contra una app global tuya.
 */
@Injectable()
export class NotificationChannelsService {
  private readonly logger = new Logger(NotificationChannelsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Lectura ───────────────────────────────────────────────────────────────

  /**
   * `target` y `credentials` no salen enteros nunca: el primero es un webhook
   * que permite publicar en el canal del tenant, y el segundo un token de bot.
   */
  async list(tenantId: string) {
    const rows = await this.prisma.notificationChannel.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.serialize(r));
  }

  private serialize(r: any) {
    return {
      id: r.id,
      provider: r.provider,
      label: r.label,
      targetHint: this.hint(r.provider, r.target),
      types: r.types,
      isActive: r.isActive,
      pending: !r.target, // emparejamiento de Telegram sin completar
      lastSentAt: r.lastSentAt,
      lastErrorAt: r.lastErrorAt,
      lastErrorMsg: r.lastErrorMsg,
      createdAt: r.createdAt,
    };
  }

  /** Lo justo para que el tenant reconozca el destino sin exponerlo. */
  private hint(provider: string, target: string): string {
    if (!target) return '';
    if (provider === 'discord') {
      // .../webhooks/<id>/<token> — el token es lo que hay que ocultar.
      const id = target.match(/webhooks\/(\d+)/)?.[1];
      return id ? `webhook ${id}` : 'webhook';
    }
    if (provider === 'telegram') return `chat ${target}`;
    return target;
  }

  // ── Alta y baja ───────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateChannelDto) {
    // Solo webhooks de Discord: sin esto, el campo aceptaria cualquier URL y el
    // servidor haria peticiones POST a donde le dijeran.
    if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(dto.target)) {
      throw new BadRequestException(
        'La URL debe ser un webhook de Discord (https://discord.com/api/webhooks/...)',
      );
    }

    const row = await this.prisma.notificationChannel.create({
      data: {
        tenantId,
        provider: 'discord',
        label: dto.label,
        target: dto.target,
        types: dto.types ?? [],
      },
    });
    return this.serialize(row);
  }

  async update(tenantId: string, id: string, dto: UpdateChannelDto) {
    await this.owned(tenantId, id);
    const row = await this.prisma.notificationChannel.update({
      where: { id },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.types !== undefined ? { types: dto.types } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    return this.serialize(row);
  }

  async remove(tenantId: string, id: string) {
    await this.owned(tenantId, id);
    await this.prisma.notificationChannel.delete({ where: { id } });
    return { message: 'Canal eliminado' };
  }

  /** Comprueba pertenencia antes de tocar nada: el id solo no basta. */
  private async owned(tenantId: string, id: string) {
    const row = await this.prisma.notificationChannel.findFirst({
      where: { id, tenantId },
    });
    if (!row) throw new NotFoundException('Canal no encontrado');
    return row;
  }

  // ── Prueba ────────────────────────────────────────────────────────────────

  /**
   * Manda un mensaje de prueba. Es lo unico que le dice al tenant si el canal
   * quedo bien configurado — sin esto se entera cuando falle de verdad.
   */
  async test(tenantId: string, id: string) {
    const row = await this.owned(tenantId, id);
    if (!row.target) {
      throw new BadRequestException('El canal aun no esta vinculado');
    }

    const result = await sendChatMessage(
      {
        provider: row.provider as ChatProvider,
        target: row.target,
        credentials: row.credentials as Record<string, unknown> | null,
      },
      {
        title: 'Prueba de conexion',
        message:
          'Si estas leyendo esto, el canal quedo bien configurado y recibira las notificaciones del CRM.',
        type: 'TEST',
        priority: 'normal',
        actionUrl: '/dashboard/notifications',
      },
    );

    await this.recordResult(id, result.ok, result.error);
    if (!result.ok) throw new BadRequestException(result.error);
    return { ok: true };
  }

  /** Deja constancia del ultimo envio para que la UI pueda mostrar el estado. */
  async recordResult(id: string, ok: boolean, error?: string) {
    await this.prisma.notificationChannel
      .update({
        where: { id },
        data: ok
          ? { lastSentAt: new Date(), lastErrorAt: null, lastErrorMsg: null }
          : { lastErrorAt: new Date(), lastErrorMsg: error?.slice(0, 500) ?? 'error' },
      })
      .catch(() => undefined);
  }

  // ── Telegram ──────────────────────────────────────────────────────────────

  /**
   * Crea la fila sin destino y devuelve el codigo que el tenant tiene que
   * mandarle al bot. El `chat_id` lo rellena el webhook cuando llegue.
   */
  async startTelegramLink(tenantId: string, label: string) {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new BadRequestException(
        'Telegram no esta configurado en el servidor (falta TELEGRAM_BOT_TOKEN)',
      );
    }

    const linkCode = randomBytes(6).toString('hex');
    const row = await this.prisma.notificationChannel.create({
      data: {
        tenantId,
        provider: 'telegram',
        label,
        target: '', // lo completa el webhook
        linkCode,
        linkCodeExpiresAt: new Date(Date.now() + LINK_CODE_TTL_MS),
      },
    });

    return {
      id: row.id,
      linkCode,
      botUsername: botUsername ?? null,
      // Enlace directo: abre el bot con el codigo ya puesto.
      deepLink: botUsername ? `https://t.me/${botUsername}?start=${linkCode}` : null,
      expiresAt: row.linkCodeExpiresAt,
    };
  }

  /**
   * Canjea un codigo por el `chat_id` que lo envio. Lo llama el webhook, que
   * es publico y llega sin tenant: por eso `linkCode` es unico en toda la tabla.
   */
  async redeemTelegramCode(code: string, chatId: string): Promise<boolean> {
    const row = await this.prisma.notificationChannel.findUnique({
      where: { linkCode: code },
    });
    if (!row) return false;
    if (row.linkCodeExpiresAt && row.linkCodeExpiresAt < new Date()) return false;

    await this.prisma.notificationChannel.update({
      where: { id: row.id },
      // El codigo se consume: un solo uso.
      data: { target: String(chatId), linkCode: null, linkCodeExpiresAt: null },
    });
    this.logger.log(`[Chat] Telegram vinculado para tenant=${row.tenantId}`);
    return true;
  }

  // ── Slack ─────────────────────────────────────────────────────────────────

  getSlackOAuthUrl(tenantId: string, redirectUri: string): string {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) {
      throw new BadRequestException(
        'Slack no esta configurado en el servidor (falta SLACK_CLIENT_ID)',
      );
    }
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'chat:write,channels:read',
      redirect_uri: redirectUri,
      state: tenantId,
    });
    return `https://slack.com/oauth/v2/authorize?${params}`;
  }

  async connectSlack(
    tenantId: string,
    code: string,
    redirectUri: string,
    label?: string,
  ) {
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new BadRequestException('Slack no esta configurado en el servidor');
    }

    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      access_token?: string;
      incoming_webhook?: { channel?: string; channel_id?: string };
      team?: { name?: string };
    };

    if (!json.ok || !json.access_token) {
      throw new BadRequestException(`Slack: ${json.error ?? 'no se pudo conectar'}`);
    }

    const channelId = json.incoming_webhook?.channel_id;
    if (!channelId) {
      throw new BadRequestException(
        'Slack no devolvio ningun canal. Elige un canal al autorizar la app.',
      );
    }

    const row = await this.prisma.notificationChannel.create({
      data: {
        tenantId,
        provider: 'slack',
        label:
          label ||
          `${json.team?.name ?? 'Slack'} ${json.incoming_webhook?.channel ?? ''}`.trim(),
        target: channelId,
        credentials: { botToken: json.access_token },
      },
    });
    return this.serialize(row);
  }
}
