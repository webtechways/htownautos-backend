import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { PricePredictionService } from './price-prediction.service';

/**
 * Tasa en masa los lotes que todavia no se han subastado.
 *
 * El trabajo de embebido llena el material de ENTRENAMIENTO con ventas
 * pasadas; este usa el modelo ya entrenado para poner precio a lo que se va a
 * vender. Comparten la GPU y poco mas.
 *
 * Tasar un lote futuro necesita sus fotos convertidas en vector, asi que el
 * proceso es en dos tiempos: primero se asegura el vector, despues se predice.
 * Que hacer con los que no lo tienen lo decide `photoMode`, porque las tres
 * respuestas razonables cuestan cosas distintas: esperar, pagar GPU, o aceptar
 * una prediccion peor.
 */
@Injectable()
export class BulkPredictService {
  private readonly logger = new Logger(BulkPredictService.name);
  /** Una pasada a la vez: dos escribiendo las mismas filas no aporta nada. */
  private enMarcha = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly precios: PricePredictionService,
  ) {}

  async config() {
    const c = await this.prisma.pricePredictConfig.findUnique({ where: { id: 'singleton' } });
    return c ?? this.prisma.pricePredictConfig.create({ data: { id: 'singleton' } });
  }

  async guardar(patch: Record<string, unknown>) {
    const permitidos = [
      'selDated', 'selUndated', 'selSaleDateFrom', 'selSaleDateTo', 'selStates',
      'selMakes', 'selMinRetail', 'selMaxRetail', 'skipAlreadyPredicted',
      'redoIfModelChanged', 'redoOlderThanDays', 'photoMode', 'maxLotsToEmbed',
      'maxLotsPerRun', 'batchSize', 'maxMinutes', 'maxCostUsdPerRun',
      'enabled', 'cronHour', 'everyDays',
    ];
    const data: Record<string, unknown> = {};
    for (const k of permitidos) if (patch[k] !== undefined) data[k] = patch[k];
    await this.config();
    return this.prisma.pricePredictConfig.update({ where: { id: 'singleton' }, data });
  }

  /**
   * El SQL que decide que lotes entran. Se usa igual para contar (la vista
   * previa) que para ejecutar, de forma que el numero que ve el usuario sea
   * exactamente el que se va a procesar.
   */
  private async seleccionar(cfg: any, limite: number, soloContar: boolean) {
    const hoy = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    const w: string[] = [];

    // Futuros: o tienen fecha por delante, o aun no la tienen.
    const fechados = `l."saleDate" >= ${hoy}`;
    const sinFecha = `l."saleDate" IS NULL`;
    if (cfg.selDated && cfg.selUndated) w.push(`(${fechados} OR ${sinFecha})`);
    else if (cfg.selDated) w.push(`(${fechados})`);
    else if (cfg.selUndated) w.push(`(${sinFecha})`);
    else return soloContar ? { total: 0 } : [];

    if (cfg.selSaleDateFrom) w.push(`l."saleDate" >= ${Number(cfg.selSaleDateFrom)}`);
    if (cfg.selSaleDateTo) w.push(`l."saleDate" <= ${Number(cfg.selSaleDateTo)}`);
    if (cfg.selMinRetail) w.push(`l."estRetailValue" >= ${Number(cfg.selMinRetail)}`);
    if (cfg.selMaxRetail) w.push(`l."estRetailValue" <= ${Number(cfg.selMaxRetail)}`);

    const lista = (txt: string) =>
      String(txt || '').split(',').map((x) => x.trim()).filter(Boolean)
        .map((x) => `'${x.replace(/'/g, "''")}'`);
    const estados = lista(cfg.selStates);
    if (estados.length) w.push(`l."locationState" IN (${estados.join(',')})`);
    const marcas = lista(cfg.selMakes);
    if (marcas.length) w.push(`upper(l."make") IN (${marcas.map((m) => m.toUpperCase()).join(',')})`);

    // Que se vuelve a tasar y que no.
    if (cfg.skipAlreadyPredicted) {
      const motivos: string[] = [`p.lot IS NULL`];
      if (cfg.redoIfModelChanged) motivos.push(`p."modelVersion" <> $1`);
      if (cfg.redoOlderThanDays > 0) {
        motivos.push(`p."predictedAt" < now() - interval '${Number(cfg.redoOlderThanDays)} days'`);
      }
      w.push(`(${motivos.join(' OR ')})`);
    }

    // Sin fotos convertidas no hay prediccion con imagenes; el modo decide.
    if (cfg.photoMode === 'conVector') w.push(`v."lotNumber" IS NOT NULL AND v.dims > 0`);

    const version = (await this.precios.versionServida()) ?? '';
    const base = `
      FROM auction_listings l
      LEFT JOIN lot_image_vectors v ON v."lotNumber" = l."lotNumber"
      LEFT JOIN lot_price_predictions p ON p.lot = l."lotNumber"
      WHERE ${w.join(' AND ')}`;

    if (soloContar) {
      const r = (await this.prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE v."lotNumber" IS NOT NULL AND v.dims > 0)::int AS "conVector"
         ${base}`, version)) as any[];
      return r[0] ?? { total: 0, conVector: 0 };
    }
    return (await this.prisma.$queryRawUnsafe(
      `SELECT l."lotNumber" AS lot ${base}
       ORDER BY l."saleDate" NULLS LAST, l."lotNumber"
       LIMIT ${Math.max(1, Number(limite))}`, version)) as any[];
  }

  /** Cuantos lotes entrarian con los ajustes actuales. */
  async vistaPrevia(patch?: Record<string, unknown>) {
    const cfg = { ...(await this.config()), ...(patch ?? {}) };
    const r: any = await this.seleccionar(cfg, 0, true);
    return {
      total: r.total ?? 0,
      conVector: r.conVector ?? 0,
      sinVector: Math.max(0, (r.total ?? 0) - (r.conVector ?? 0)),
      entraran: Math.min(r.total ?? 0, Number(cfg.maxLotsPerRun)),
    };
  }

  async estado() {
    const [cfg, ya, ultimas, version] = await Promise.all([
      this.config(),
      this.prisma.lotPricePrediction.count(),
      this.prisma.pricePredictRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20 }),
      this.precios.versionServida(),
    ]);
    const previa = await this.vistaPrevia().catch(() => null);
    const desfasadas = version
      ? await this.prisma.lotPricePrediction.count({ where: { modelVersion: { not: version } } })
      : 0;
    return {
      config: cfg,
      modelVersion: version,
      yaPredichos: ya,
      desfasadas,
      previa,
      runs: ultimas,
      enMarcha: this.enMarcha,
    };
  }

  /** Lanza una pasada. Devuelve en cuanto arranca; el progreso va en el run. */
  async ejecutar(trigger: 'manual' | 'cron' = 'manual') {
    if (this.enMarcha) return { ok: false, motivo: 'Ya hay una pasada en marcha' };
    const cfg = await this.config();
    const run = await this.prisma.pricePredictRun.create({
      data: { status: 'predicting', trigger, log: [] as any },
    });
    this.enMarcha = true;
    void this.correr(run.id, cfg).catch(async (e) => {
      this.logger.error(`[Prediccion masiva] ${e?.message}`);
      await this.prisma.pricePredictRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: String(e?.message ?? e), finishedAt: new Date() },
      }).catch(() => undefined);
    }).finally(() => { this.enMarcha = false; });
    return { ok: true, runId: run.id };
  }

  private async correr(runId: string, cfg: any) {
    const t0 = Date.now();
    const traza: string[] = [];
    const apuntar = async (txt: string) => {
      traza.push(`[${new Date().toISOString()}] ${txt}`);
      await this.prisma.pricePredictRun.update({
        where: { id: runId }, data: { log: traza as any },
      }).catch(() => undefined);
    };

    const version = (await this.precios.versionServida()) ?? 'desconocida';
    const pca = await this.precios.pcaServido();
    await apuntar(`modelo ${version} · agrupacion ${pca ?? 'n/d'}`);

    const filas: any[] = (await this.seleccionar(cfg, cfg.maxLotsPerRun, false)) as any[];
    await apuntar(`${filas.length} lotes seleccionados`);
    await this.prisma.pricePredictRun.update({
      where: { id: runId }, data: { lotesElegibles: filas.length, modelVersion: version },
    });

    const limite = t0 + Number(cfg.maxMinutes) * 60_000;
    let predichos = 0;
    let conFotos = 0;
    const tam = Math.max(1, Number(cfg.batchSize));

    for (let i = 0; i < filas.length; i += tam) {
      if (Date.now() > limite) {
        await apuntar(`tope de ${cfg.maxMinutes} min alcanzado: se corta`);
        break;
      }
      const trozo = filas.slice(i, i + tam).map((f) => BigInt(f.lot));
      const { payloads, conVector } = await this.payloads(trozo, pca);
      if (!payloads.length) continue;

      const res = await this.precios.predecirLote(payloads);
      const escritos = await this.guardarPredicciones(res, runId, version);
      predichos += escritos;
      conFotos += conVector;
      await this.prisma.pricePredictRun.update({
        where: { id: runId },
        data: { lotesPredichos: predichos, lotesConFotos: conFotos },
      });
      if (i % (tam * 10) === 0) await apuntar(`${predichos} lotes tasados`);
    }

    await apuntar(`fin: ${predichos} tasados, ${conFotos} con fotos`);
    await this.prisma.pricePredictRun.update({
      where: { id: runId },
      data: { status: 'done', finishedAt: new Date(), lotesPredichos: predichos, lotesConFotos: conFotos },
    });
    await this.prisma.pricePredictConfig.update({
      where: { id: 'singleton' }, data: { lastRunAt: new Date() },
    });
  }

  /** Convierte un grupo de lotes en payloads para el servicio de ML. */
  private async payloads(lots: bigint[], pca: string | null) {
    const [listings, vectores, prebids] = await Promise.all([
      this.prisma.auctionListing.findMany({ where: { lotNumber: { in: lots } } }),
      this.prisma.lotImageVector.findMany({
        where: { lotNumber: { in: lots } },
        select: { lotNumber: true, vector: true, dims: true, pcaVersion: true },
      }),
      this.prisma.auctionBidEvent.findMany({
        where: { lot: { in: lots }, eventType: 'PREBID' },
        select: { lot: true, buyerNo: true },
        distinct: ['lot', 'buyerNo'],
      }),
    ]);

    const porLote = new Map(vectores.map((v) => [String(v.lotNumber), v]));
    const pujas = new Map<string, number>();
    for (const p of prebids) {
      const k = String(p.lot);
      pujas.set(k, (pujas.get(k) ?? 0) + 1);
    }

    const payloads: Record<string, unknown>[] = [];
    let conVector = 0;
    for (const l of listings) {
      const v = porLote.get(String(l.lotNumber));
      // Un vector de otra agrupacion no es peor: significa otra cosa. Se
      // descarta, o el modelo devuelve un precio inventado con total seguridad.
      const sirve = !!v && v.dims > 0 && (!pca || !v.pcaVersion || v.pcaVersion === pca);
      const vec = sirve ? this.precios.vectorDeFila(v!.vector as any, v!.dims) : null;
      if (vec) conVector += 1;
      payloads.push(
        this.precios.payloadDeLote(l, vec, pujas.get(String(l.lotNumber)) ?? 0,
          this.contarFotos(l.galleryCache)),
      );
    }
    return { payloads, conVector };
  }

  private contarFotos(gallery: unknown): number {
    if (!gallery) return 0;
    try {
      const g: any = typeof gallery === 'string' ? JSON.parse(gallery) : gallery;
      if (Array.isArray(g)) return g.length;
      if (Array.isArray(g?.images)) return g.images.length;
    } catch { /* una galeria ilegible no puede tumbar la pasada */ }
    return 0;
  }

  private async guardarPredicciones(res: any[], runId: string, version: string) {
    let n = 0;
    for (const r of res) {
      if (!r?.lot || r.esperado == null) continue;
      let lot: bigint;
      try { lot = BigInt(r.lot); } catch { continue; }
      await this.prisma.lotPricePrediction.upsert({
        where: { lot },
        create: {
          lot, esperado: Math.round(r.esperado), p10: Math.round(r.p10),
          p90: Math.round(r.p90), incertidumbre: r.incertidumbre ?? 0,
          conImagenes: r.conImagenes === true, modelVersion: version, runId,
        },
        update: {
          esperado: Math.round(r.esperado), p10: Math.round(r.p10),
          p90: Math.round(r.p90), incertidumbre: r.incertidumbre ?? 0,
          conImagenes: r.conImagenes === true, modelVersion: version, runId,
          predictedAt: new Date(),
        },
      }).then(() => { n += 1; }).catch(() => undefined);
    }
    return n;
  }
}
