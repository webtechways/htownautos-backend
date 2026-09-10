import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  RabbitMQService,
  CHAT_DISPATCH_QUEUE,
  type ChatDispatchMessage,
} from '@htownautos/rabbitmq';
import { PrismaService } from '@htownautos/prisma';
import {
  channelWantsType,
  sendChatMessage,
  type ChatProvider,
} from '@htownautos/common';

/**
 * Saca las notificaciones del tenant a sus canales de chat.
 *
 * Vive aqui y no en la `api` porque cada mensaje son una o varias peticiones
 * HTTP a terceros —Telegram, Discord, Slack— y el productor es
 * `notifyTenantStaff`, al que se llama desde caminos que atienden a clientes.
 *
 * Un canal roto no puede tumbar a los demas ni hacer que el mensaje se
 * reencole: el fallo se guarda en la propia fila del canal y ahi se queda,
 * visible en la UI de Integraciones.
 */
@Injectable()
export class ChatDispatchConsumer implements OnModuleInit {
  private readonly logger = new Logger(ChatDispatchConsumer.name);

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQ.consume(CHAT_DISPATCH_QUEUE, async (raw) => {
      await this.handle(raw as ChatDispatchMessage);
    });
  }

  private async handle(msg: ChatDispatchMessage): Promise<void> {
    if (!msg?.tenantId || !msg?.type) return;

    const canales = await this.prisma.notificationChannel.findMany({
      where: { tenantId: msg.tenantId, isActive: true },
    });
    if (canales.length === 0) return;

    // Un canal sin tipos elegidos quiere todo; el resto, solo lo suyo. Y los
    // que aun no completaron el emparejamiento no tienen destino.
    const destinatarios = canales.filter(
      (c) => c.target && channelWantsType(c.types, msg.type),
    );
    if (destinatarios.length === 0) return;

    const resultados = await Promise.allSettled(
      destinatarios.map(async (c) => {
        const res = await sendChatMessage(
          {
            provider: c.provider as ChatProvider,
            target: c.target,
            credentials: c.credentials as Record<string, unknown> | null,
          },
          {
            title: msg.title,
            message: msg.message,
            type: msg.type,
            priority: msg.priority,
            actionUrl: msg.actionUrl,
          },
        );

        await this.prisma.notificationChannel
          .update({
            where: { id: c.id },
            data: res.ok
              ? { lastSentAt: new Date(), lastErrorAt: null, lastErrorMsg: null }
              : {
                  lastErrorAt: new Date(),
                  lastErrorMsg: res.error?.slice(0, 500) ?? 'error',
                },
          })
          .catch(() => undefined);

        return res.ok;
      }),
    );

    const fallos = resultados.filter(
      (r) => r.status === 'rejected' || r.value === false,
    ).length;

    if (fallos > 0) {
      this.logger.warn(
        `[Chat] tenant=${msg.tenantId} type=${msg.type} — ${fallos}/${destinatarios.length} canal(es) fallaron`,
      );
    }
  }
}
