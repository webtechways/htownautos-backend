import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { RunpodService } from '@htownautos/common';

const CONFIG_ID = 'singleton';
const POD_PREFIX = 'htownautos-embed';

/**
 * Panel de control del job nocturno de vectores: estado, historial, coste y las
 * palancas manuales.
 *
 * La API no ejecuta el job —eso vive en data-sync, que es donde estan los crons—
 * pero si puede pedirlo dejando una fila en `pending`, que data-sync recoge en
 * menos de un minuto.
 *
 * El apagado manual de un pod SI se hace desde aqui, a proposito: es la palanca
 * de emergencia, y tiene que funcionar aunque data-sync este caido, que es
 * justamente cuando hace falta.
 */
@Injectable()
export class EmbedJobsService {
  private readonly logger = new Logger(EmbedJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runpod: RunpodService,
  ) {}

  async config() {
    return this.prisma.embedJobConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
    });
  }

  async updateConfig(data: Record<string, unknown>) {
    const permitidos = [
      'enabled', 'cronHour', 'gpuTypeIds', 'imageName',
      'maxLotsPerRun', 'maxMinutes', 'maxCostUsdPerRun', 'watchdogMinutes',
    ];
    const limpio: Record<string, unknown> = {};
    for (const k of permitidos) if (data[k] !== undefined) limpio[k] = data[k];
    return this.prisma.embedJobConfig.update({ where: { id: CONFIG_ID }, data: limpio });
  }

  /** Lo que pinta la pantalla de Auction Data. */
  async status() {
    const [cfg, pendientes, conVector, ultimas, gasto] = await Promise.all([
      this.config(),
      this.countPending(),
      this.prisma.lotImageVector.count(),
      this.prisma.embedJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
      this.spend(),
    ]);

    // Pods vivos segun RunPod, no segun nuestra tabla: si los dos no coinciden,
    // es justo lo que hay que ver.
    let podsVivos: { id: string; name?: string; costPerHr?: number | string }[] = [];
    let runpodError: string | null = null;
    try {
      podsVivos = (await this.runpod.listPods())
        .filter((p) => (p.name ?? '').startsWith(POD_PREFIX))
        .map((p) => ({ id: p.id, name: p.name, costPerHr: p.costPerHr }));
    } catch (err: any) {
      runpodError = err.message;
    }

    const activa = ultimas.find((r) => ['pending', 'provisioning', 'running'].includes(r.status));

    return {
      config: cfg,
      cobertura: { lotesConVector: conVector, lotesPendientes: pendientes },
      ejecucionActiva: activa ?? null,
      ejecuciones: ultimas,
      gasto,
      podsVivos,
      runpodError,
      /** Un pod vivo sin ejecucion activa es dinero ardiendo: la UI lo marca en rojo. */
      alerta: podsVivos.length > 0 && !activa
        ? `Hay ${podsVivos.length} pod(s) encendidos sin ninguna ejecucion en curso`
        : null,
    };
  }

  async countPending(): Promise<number> {
    const r = (await this.prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n
         FROM auction_listings l
         LEFT JOIN lot_image_vectors v ON v."lotNumber" = l."lotNumber"
        WHERE l."galleryCachedAt" IS NOT NULL AND v."lotNumber" IS NULL
          AND COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) > 0`,
    )) as { n: number }[];
    return Number(r[0]?.n ?? 0);
  }

  /** Coste acumulado, para que el gasto no sea una sorpresa a fin de mes. */
  async spend() {
    const r = (await this.prisma.$queryRawUnsafe(
      `SELECT
         COALESCE(sum("costUsd") FILTER (WHERE "startedAt" > now() - interval '1 day'), 0)::float  AS dia,
         COALESCE(sum("costUsd") FILTER (WHERE "startedAt" > now() - interval '7 days'), 0)::float AS semana,
         COALESCE(sum("costUsd") FILTER (WHERE "startedAt" > now() - interval '30 days'), 0)::float AS mes,
         COALESCE(sum("costUsd"), 0)::float AS total,
         COALESCE(sum("gpuSeconds"), 0)::int AS segundosGpu
       FROM embed_job_runs`,
    )) as any[];
    return r[0] ?? { dia: 0, semana: 0, mes: 0, total: 0, segundosGpu: 0 };
  }

  async runDetail(id: string) {
    const run = await this.prisma.embedJobRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Ejecucion no encontrada');
    return run;
  }

  /** Deja la peticion en el buzon; data-sync la recoge en menos de un minuto. */
  async requestRun() {
    const yaHay = await this.prisma.embedJobRun.findFirst({
      where: { status: { in: ['pending', 'provisioning', 'running'] } },
    });
    if (yaHay) return { ok: false, motivo: 'Ya hay una ejecucion en curso', run: yaHay };
    const run = await this.prisma.embedJobRun.create({
      data: { status: 'pending', log: '[cola] ejecucion pedida a mano\n' },
    });
    return { ok: true, run };
  }

  /**
   * Palanca de emergencia: borra TODOS nuestros pods sin preguntar a data-sync.
   * Se llama desde el boton rojo de la pantalla.
   */
  async killAll(): Promise<{ borrados: string[]; fallidos: string[] }> {
    const pods = (await this.runpod.listPods()).filter((p) =>
      (p.name ?? '').startsWith(POD_PREFIX),
    );
    const borrados: string[] = [];
    const fallidos: string[] = [];
    for (const p of pods) {
      const ok = await this.runpod.deletePod(p.id);
      (ok ? borrados : fallidos).push(p.id);
      if (ok) {
        await this.prisma.embedJobRun
          .updateMany({
            where: { podId: p.id, terminatedAt: null },
            data: {
              terminatedAt: new Date(), terminatedBy: 'manual',
              status: 'aborted', finishedAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
    }
    this.logger.warn(`[EmbedJobs] apagado manual: ${borrados.length} borrados, ${fallidos.length} fallidos`);
    return { borrados, fallidos };
  }

  // ─────────── Lo que llama el pod ───────────

  /** El manifiesto: que lotes embeber y de que claves de B2 bajar sus fotos. */
  async manifest(runId: string, maxSeq = 9) {
    const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Ejecucion no encontrada');

    const filas = (await this.prisma.$queryRawUnsafe(
      `SELECT l."lotNumber"::text AS lot,
              (img->>'sequence')::int AS seq
         FROM auction_listings l
         LEFT JOIN lot_image_vectors v ON v."lotNumber" = l."lotNumber"
         CROSS JOIN LATERAL json_array_elements(l."galleryCache"::json->'images') AS img
        WHERE l."galleryCachedAt" IS NOT NULL AND v."lotNumber" IS NULL
          AND (img->>'sequence')::int <= $1
        ORDER BY l."saleDate" ASC NULLS LAST, l."lotNumber", 2
        LIMIT $2`,
      maxSeq,
      run.lotsRequested * maxSeq,
    )) as { lot: string; seq: number }[];

    return {
      runId,
      // La clave se construye aqui y no en el pod para que el formato viva en un
      // solo sitio (lo escribe gallery-cache.service.ts al subir a B2).
      items: filas.map((f) => ({ lot: f.lot, seq: f.seq, key: `gallery/${f.lot}/${f.seq}_hrs.jpg` })),
    };
  }

  /** Recibe un lote de vectores ya reducidos por PCA. */
  async saveVectors(
    runId: string,
    items: { lot: string; vector: number[]; imageCount: number }[],
    encoder: string,
    pcaVersion: string,
  ) {
    let guardados = 0;
    for (const it of items) {
      const buf = Buffer.from(new Float32Array(it.vector).buffer);
      await this.prisma.lotImageVector
        .upsert({
          where: { lotNumber: BigInt(it.lot) },
          create: {
            lotNumber: BigInt(it.lot), vector: buf, dims: it.vector.length,
            encoder, pcaVersion, imageCount: it.imageCount,
          },
          update: { vector: buf, dims: it.vector.length, encoder, pcaVersion, imageCount: it.imageCount },
        })
        .then(() => { guardados++; })
        .catch((e) => this.logger.warn(`[EmbedJobs] lote ${it.lot}: ${e.message}`));
    }
    await this.prisma.embedJobRun.update({
      where: { id: runId },
      data: { lotsDone: { increment: guardados } },
    }).catch(() => undefined);
    return { guardados };
  }

  async complete(runId: string, body: { imagesDone?: number; imagesFailed?: number; error?: string }) {
    return this.prisma.embedJobRun.update({
      where: { id: runId },
      data: {
        status: body.error ? 'failed' : 'done',
        finishedAt: new Date(),
        imagesDone: body.imagesDone ?? 0,
        imagesFailed: body.imagesFailed ?? 0,
        error: body.error ?? null,
      },
    });
  }

  async appendLog(runId: string, linea: string) {
    const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const log = `${run.log ?? ''}[${new Date().toISOString()}] ${linea}\n`;
    await this.prisma.embedJobRun
      .update({ where: { id: runId }, data: { log: log.slice(-40_000) } })
      .catch(() => undefined);
  }
}
