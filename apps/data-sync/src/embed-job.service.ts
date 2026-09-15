import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { RunpodService } from '@htownautos/common';

const CONFIG_ID = 'singleton';
/** Prefijo por el que el vigilante reconoce NUESTROS pods y no toca los ajenos. */
export const POD_PREFIX = 'htownautos-embed';
const POLL_MS = 20_000;

/**
 * Job nocturno: convierte las fotos de los lotes nuevos en vectores.
 *
 * El modelo de precio puede mirar las fotos de un coche solo si alguien las
 * tradujo antes a numeros. Este job es ese traductor. Corre de madrugada porque
 * los lotes se cachean con dias de antelacion (el 97% con uno o mas), asi que
 * llega de sobra antes del remate.
 *
 * Nunca reprocesa: las fotos de un lote no cambian, asi que un lote embebido esta
 * resuelto para siempre. Solo anade.
 *
 * ── Sobre apagar el pod ──
 * Un pod olvidado encendido cuesta ~$25 al mes por nada. Hay cinco vias
 * independientes de apagado y ninguna depende de que las otras funcionen:
 *
 *   1. `finally` de este servicio — el caso normal
 *   2. Fecha limite (`maxMinutes`) comprobada en cada vuelta del sondeo
 *   3. Tope de coste (`maxCostUsdPerRun`)
 *   4. Vigilante independiente cada pocos minutos (embed-job-watchdog)
 *   5. Auto-destruccion dentro del propio pod, que no necesita que este backend
 *      siga vivo
 *
 * Cada apagado deja escrito en `terminatedBy` cual de las vias actuo. Si algo
 * distinto de `job` aparece con frecuencia, es que la via normal esta fallando.
 */
@Injectable()
export class EmbedJobService {
  private readonly logger = new Logger(EmbedJobService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runpod: RunpodService,
  ) {}

  /**
   * Al arrancar el servicio, apaga cualquier pod que quedara vivo de una
   * ejecucion anterior. Cubre el caso de que el contenedor muriera a mitad: sin
   * esto el pod seguiria facturando y nadie lo sabria.
   */
  async onModuleInit(): Promise<void> {
    const huerfanas = await this.prisma.embedJobRun.findMany({
      where: { status: { in: ['provisioning', 'running'] }, podId: { not: null } },
    });
    for (const r of huerfanas) {
      this.logger.warn(`[EmbedJob] ejecucion ${r.id} quedo viva; apagando pod ${r.podId}`);
      await this.terminate(r.id, r.podId!, 'boot', 'El servicio se reinicio a mitad');
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (this.running) return;
    const cfg = await this.config();
    if (!cfg.enabled) return;

    // Hora Central: los remates van en esa zona y la config se escribe pensando
    // en ella, no en UTC.
    const hora = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
      }).format(new Date()),
    );
    if (hora !== cfg.cronHour) return;

    const ultima = cfg.lastRunAt?.getTime() ?? 0;
    if (Date.now() - ultima < 20 * 3_600_000) return; // una vez al dia

    await this.run('cron');
  }

  /** Lotes con fotos cacheadas que todavia no tienen vector. */
  async pending(limit: number): Promise<{ lot: bigint; imageCount: number }[]> {
    // El getter de PrismaService devuelve la funcion ya enlazada y pierde la
    // firma generica, asi que el tipo se pone con un cast en el resultado
    // (mismo patron que StatsService.breakdown).
    const filas = (await this.prisma.$queryRawUnsafe(
      `SELECT l."lotNumber" AS lot,
              COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) AS n
         FROM auction_listings l
         LEFT JOIN lot_image_vectors v ON v."lotNumber" = l."lotNumber"
        WHERE l."galleryCachedAt" IS NOT NULL
          AND v."lotNumber" IS NULL
          AND COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) > 0
        ORDER BY l."saleDate" ASC NULLS LAST
        LIMIT $1`,
      limit,
    )) as { lot: bigint; n: number }[];
    return filas.map((f) => ({ lot: f.lot, imageCount: Number(f.n) }));
  }

  async config() {
    return this.prisma.embedJobConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
    });
  }

  /**
   * Recoge ejecuciones que la API dejo en `pending` al pulsar "ejecutar ahora".
   * La API y data-sync son procesos distintos, asi que la tabla hace de buzon en
   * vez de montar una cola solo para esto.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async pickup(): Promise<void> {
    if (this.running) return;
    const pendiente = await this.prisma.embedJobRun.findFirst({
      where: { status: 'pending' },
      orderBy: { startedAt: 'asc' },
    });
    if (pendiente) await this.run('manual', pendiente.id);
  }

  /** Lanza una ejecucion. `origen` queda en el log para distinguir cron de manual. */
  async run(origen: string, adoptarId?: string): Promise<string | null> {
    if (this.running) {
      this.logger.warn('[EmbedJob] ya hay una ejecucion en curso');
      return null;
    }
    const cfg = await this.config();
    const lotes = await this.pending(cfg.maxLotsPerRun);
    if (!lotes.length) {
      this.logger.log('[EmbedJob] no hay lotes pendientes');
      if (adoptarId) {
        await this.prisma.embedJobRun.update({
          where: { id: adoptarId },
          data: { status: 'done', finishedAt: new Date(), log: 'No habia lotes pendientes.\n' },
        });
      }
      return null;
    }

    this.running = true;
    const cabecera = `[${new Date().toISOString()}] ${origen}: ${lotes.length} lotes pendientes\n`;
    const run = adoptarId
      ? await this.prisma.embedJobRun.update({
          where: { id: adoptarId },
          data: { status: 'provisioning', lotsRequested: lotes.length, log: cabecera },
        })
      : await this.prisma.embedJobRun.create({
          data: { status: 'provisioning', lotsRequested: lotes.length, log: cabecera },
        });

    let podId: string | null = null;
    try {
      const api = process.env.EMBED_CALLBACK_URL ?? 'http://api:3000/api/v1';
      const pod = await this.runpod.createPod({
        name: `${POD_PREFIX}-${run.id.slice(0, 8)}`,
        // Imagen estandar de RunPod: el codigo se descarga de la API al arrancar.
        // Evita depender de un registro propio y garantiza que worker y PCA son
        // los de la version desplegada del backend.
        imageName: cfg.imageName || 'runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04',
        dockerStartCmd: [
          'bash', '-lc',
          `curl -fsS -H "X-API-Key: $API_KEY" "${api}/embed-pod/bootstrap.sh" | bash`,
        ],
        gpuTypeIds: cfg.gpuTypeIds.split(',').map((s) => s.trim()).filter(Boolean),
        containerDiskInGb: 60,
        env: {
          RUN_ID: run.id,
          API_URL: api,
          API_KEY: process.env.AUCTION_INGEST_API_KEY ?? '',
          B2_KEY_ID: process.env.B2_KEY_ID ?? '',
          B2_APP_KEY: process.env.B2_APP_KEY ?? '',
          B2_ENDPOINT: process.env.B2_ENDPOINT ?? '',
          B2_BUCKET_PUBLIC: process.env.B2_BUCKET_PUBLIC ?? '',
          RUNPOD_API_KEY: process.env.RUNPOD_API_KEY ?? process.env.RUNPOD ?? '',
          // Via 5: el propio pod se borra al terminar o al vencer el plazo, sin
          // necesitar que este backend siga vivo.
          MAX_MINUTES: String(cfg.maxMinutes),
        },
      });
      podId = pod.id;

      await this.prisma.embedJobRun.update({
        where: { id: run.id },
        data: {
          podId: pod.id,
          podType: pod.gpu?.displayName ?? pod.machine?.gpuDisplayName ?? null,
          costPerHr: pod.costPerHr ? Number(pod.costPerHr) : null,
          status: 'running',
          podReadyAt: new Date(),
        },
      });
      await this.append(run.id, `pod ${pod.id} (${pod.gpu?.displayName ?? '?'}) a $${pod.costPerHr}/h`);

      await this.poll(run.id, podId, cfg);
    } catch (err: any) {
      this.logger.error(`[EmbedJob] ${err.message}`);
      await this.prisma.embedJobRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: err.message, finishedAt: new Date() },
      }).catch(() => undefined);
    } finally {
      // Via 1. Pase lo que pase.
      if (podId) await this.terminate(run.id, podId, 'job', null);
      await this.prisma.embedJobConfig
        .update({ where: { id: CONFIG_ID }, data: { lastRunAt: new Date() } })
        .catch(() => undefined);
      this.running = false;
    }
    return run.id;
  }

  /** Sondea hasta que el pod reporta el final, vence el plazo o se pasa de coste. */
  private async poll(runId: string, podId: string, cfg: any): Promise<void> {
    const limite = Date.now() + cfg.maxMinutes * 60_000;

    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
      if (!run) return;

      if (run.status === 'done' || run.status === 'failed') return;

      // Via 2: plazo vencido.
      if (Date.now() > limite) {
        await this.abort(runId, `Plazo de ${cfg.maxMinutes} min agotado`, 'deadline');
        return;
      }

      // Via 3: tope de coste.
      const horas = (Date.now() - run.startedAt.getTime()) / 3_600_000;
      const coste = Number(run.costPerHr ?? 0) * horas;
      if (run.costPerHr && coste > Number(cfg.maxCostUsdPerRun)) {
        await this.abort(runId, `Tope de coste superado ($${coste.toFixed(2)})`, 'deadline');
        return;
      }

      // Si el pod desaparecio por su cuenta (se auto-destruyo o RunPod lo mato),
      // no tiene sentido seguir esperando.
      const pod = await this.runpod.getPod(podId).catch(() => null);
      if (!pod) {
        await this.append(runId, 'el pod ya no existe; se da por cerrada la ejecucion');
        await this.prisma.embedJobRun.update({
          where: { id: runId },
          data: { status: run.lotsDone > 0 ? 'done' : 'failed', finishedAt: new Date() },
        });
        return;
      }
    }
  }

  private async abort(runId: string, motivo: string, via: string): Promise<void> {
    this.logger.warn(`[EmbedJob] abortando ${runId}: ${motivo}`);
    await this.prisma.embedJobRun.update({
      where: { id: runId },
      data: { status: 'aborted', error: motivo, finishedAt: new Date() },
    });
    const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
    if (run?.podId) await this.terminate(runId, run.podId, via, motivo);
  }

  /** Apaga el pod y deja constancia de que via lo hizo. */
  async terminate(runId: string, podId: string, via: string, nota: string | null): Promise<void> {
    const ok = await this.runpod.deletePod(podId);
    const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
    if (!run) return;

    const segundos = run.podReadyAt
      ? Math.round((Date.now() - run.podReadyAt.getTime()) / 1000)
      : null;
    const coste = segundos && run.costPerHr
      ? Number(run.costPerHr) * (segundos / 3600)
      : null;

    await this.prisma.embedJobRun.update({
      where: { id: runId },
      data: {
        terminatedAt: run.terminatedAt ?? new Date(),
        terminatedBy: run.terminatedBy ?? via,
        gpuSeconds: run.gpuSeconds ?? segundos,
        costUsd: run.costUsd ?? (coste !== null ? coste.toFixed(4) : null),
        ...(run.finishedAt ? {} : { finishedAt: new Date(), status: run.status === 'running' ? 'failed' : run.status }),
      },
    }).catch(() => undefined);

    await this.append(runId, `apagado por "${via}"${ok ? '' : ' (FALLO al borrar)'}${nota ? `: ${nota}` : ''}`);
  }

  async append(runId: string, linea: string): Promise<void> {
    const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const log = `${run.log ?? ''}[${new Date().toISOString()}] ${linea}\n`;
    await this.prisma.embedJobRun
      .update({ where: { id: runId }, data: { log: log.slice(-40_000) } })
      .catch(() => undefined);
  }
}
