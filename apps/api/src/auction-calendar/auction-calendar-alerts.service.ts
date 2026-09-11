import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import {
  RabbitMQService,
  CHAT_DISPATCH_QUEUE,
  type ChatDispatchMessage,
} from '@htownautos/rabbitmq';

const CONFIG_ID = 'singleton';

/** El calendario se lee siempre en hora de Houston. */
const TZ = 'America/Chicago';

/**
 * Avisa por chat antes de que empiecen las subastas del calendario.
 *
 * Dos decisiones gobiernan el diseño, y las dos vienen del mismo sitio: hay mas
 * de setecientas subastas proximas, asi que un aviso ingenuo es un canal
 * silenciado en dos dias.
 *
 * 1. **Un solo mensaje por pasada.** Todo lo que vence en la misma ejecucion va
 *    junto, agrupado por hora de comienzo. Agrupar solo las que coinciden al
 *    minuto exacto no basta: con un umbral de 30 minutos, las de las 9:00 y las
 *    de las 9:05 caen en la misma pasada y serian dos mensajes.
 *
 * 2. **Solo las que tienen agente asignado** (configurable). Son las que el
 *    equipo va a operar de verdad; el resto es catalogo mundial.
 *
 * La deduplicacion es `alertedAt` en la propia fila, y se preserva en el
 * refresco del calendario — que borra y recrea todas las filas — porque si no,
 * cada refresco reavisaria de lo mismo.
 */
@Injectable()
export class AuctionCalendarAlertsService {
  private readonly logger = new Logger(AuctionCalendarAlertsService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      this.logger.error(`[CalendarAlerts] ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** @returns cuantas subastas se anunciaron en esta pasada. */
  async run(): Promise<number> {
    const cfg = await this.prisma.auctionCalendarConfig.findUnique({
      where: { id: CONFIG_ID },
    });
    if (!cfg?.alertsEnabled) return 0;
    if (!cfg.alertChannelIds?.length) return 0;

    const pendientes = await this.dueEntries(
      cfg.alertMinutesBefore,
      cfg.alertOnlyWithAgent,
    );
    if (pendientes.length === 0) return 0;

    const mensaje: ChatDispatchMessage = {
      tenantId: '', // el calendario es global: el destino son los canales elegidos
      type: 'AUCTION_STARTING_SOON',
      title:
        pendientes.length === 1
          ? 'Una subasta esta a punto de empezar'
          : `${pendientes.length} subastas estan a punto de empezar`,
      message: this.buildBody(pendientes),
      priority: 'high',
      actionUrl: '/dashboard/auction-data/auction-calendar',
      channelIds: cfg.alertChannelIds,
    };

    const publicado = await this.rabbitMQ.publish(CHAT_DISPATCH_QUEUE, mensaje);

    // Solo se marca si el mensaje entro en la cola. Si RabbitMQ estaba caido,
    // marcarlas igualmente seria perder el aviso en silencio para siempre.
    if (!publicado) {
      this.logger.warn('[CalendarAlerts] RabbitMQ no acepto el aviso; se reintenta');
      return 0;
    }

    await this.prisma.auctionCalendarEntry.updateMany({
      where: { id: { in: pendientes.map((e) => e.id) } },
      data: { alertedAt: new Date() },
    });

    this.logger.log(
      `[CalendarAlerts] ${pendientes.length} subasta(s) anunciadas en 1 mensaje`,
    );
    return pendientes.length;
  }

  /**
   * Las que empiezan dentro del umbral y aun no se han anunciado.
   *
   * El limite inferior es `now` a proposito: una subasta que ya empezo no se
   * anuncia. Si el proceso estuvo caido una hora, al volver no vomita avisos de
   * cosas que ya pasaron.
   */
  private dueEntries(minutos: number, soloConAgente: boolean) {
    const ahora = new Date();
    const hasta = new Date(ahora.getTime() + minutos * 60_000);

    return this.prisma.auctionCalendarEntry.findMany({
      where: {
        startedAt: { gte: ahora, lte: hasta },
        alertedAt: null,
        ...(soloConAgente ? { scraperAgentId: { not: null } } : {}),
      },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        startedAt: true,
        locationName: true,
        countryCode: true,
        totalAvailableItems: true,
        url: true,
        scraperAgent: { select: { firstName: true, lastName: true } },
      },
    });
  }

  /** Hora en Houston, que es como se lee el calendario en la UI. */
  private hora(d: Date): string {
    return d.toLocaleTimeString('es-ES', {
      timeZone: TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  /**
   * Cuerpo del mensaje: una seccion por hora de comienzo y, dentro, una linea
   * por subasta con lo que hace falta para actuar — donde, cuantos lotes y
   * quien la lleva.
   */
  private buildBody(
    entradas: {
      startedAt: Date;
      locationName: string;
      countryCode: string | null;
      totalAvailableItems: number;
      scraperAgent: { firstName: string; lastName: string } | null;
    }[],
  ): string {
    const porHora = new Map<string, typeof entradas>();
    for (const e of entradas) {
      const k = this.hora(e.startedAt);
      const lista = porHora.get(k);
      if (lista) lista.push(e);
      else porHora.set(k, [e]);
    }

    const bloques: string[] = [];
    for (const [hora, lista] of porHora) {
      const lineas = lista.map((e) => {
        const agente = e.scraperAgent
          ? `${e.scraperAgent.firstName} ${e.scraperAgent.lastName}`.trim()
          : 'sin agente';
        const lotes = e.totalAvailableItems
          ? ` · ${e.totalAvailableItems} lotes`
          : '';
        return `• ${e.locationName}${lotes} · ${agente}`;
      });
      bloques.push(`${hora} (CT)\n${lineas.join('\n')}`);
    }
    return bloques.join('\n\n');
  }
}
