import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { RunpodService, leerMetaPca } from '@htownautos/common';

const CONFIG_ID = 'singleton';
const POD_PREFIX = 'htownautos-embed';
const ML_URL = process.env.ML_SERVICE_URL ?? 'http://htownautos-ml:8000';

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
      'trainingDays', 'autoPromote', 'trainingOnlyWithImages',
      'pooling', 'imgSlots',
      'autoRebuildEnabled', 'autoRebuildEveryDays', 'autoRebuildHour',
      'maxCostUsdPerRebuild',
      'selDated', 'selFutureSale', 'selIncludePast', 'selSaleDateFrom', 'selSaleDateTo',
      'selSoldOnly',
      'maxCostPerHr',
    ];
    // Los dos limites de fecha se pueden BORRAR, asi que `null` tiene que
    // llegar a la base en vez de tratarse como "no me lo mandaron".
    const nulables = new Set(['selSaleDateFrom', 'selSaleDateTo']);
    const limpio: Record<string, unknown> = {};
    for (const k of permitidos) {
      if (data[k] !== undefined) {
        limpio[k] = nulables.has(k) && (data[k] === null || data[k] === '') ? null : data[k];
      }
    }
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

  /**
   * Deja la peticion en el buzon; data-sync la recoge en menos de un minuto.
   *
   * Con `todo` la ejecucion ignora los filtros de la config y coge la cola
   * entera, ya subastados incluidos. Es la valvula de escape para vaciarla sin
   * tener que desmontar y volver a montar los ajustes.
   */
  async requestRun(todo = false) {
    const yaHay = await this.prisma.embedJobRun.findFirst({
      where: { status: { in: ['pending', 'provisioning', 'running'] } },
    });
    if (yaHay) return { ok: false, motivo: 'Ya hay una ejecucion en curso', run: yaHay };
    const run = await this.prisma.embedJobRun.create({
      data: {
        status: 'pending',
        selectionAll: todo,
        log: todo
          ? '[cola] ejecucion pedida a mano: TODO lo pendiente, sin filtros\n'
          : '[cola] ejecucion pedida a mano\n',
      },
    });
    return { ok: true, run };
  }

  /**
   * Cuantos lotes cogeria cada grupo ahora mismo.
   *
   * Existe para que la pantalla no pida una ejecucion a ciegas: los numeros
   * cambian cada dia segun lo que Copart fecha y lo que el crawler cachea, y la
   * diferencia entre marcar una casilla u otra son horas de GPU.
   */
  async selectionPreview() {
    const d = new Date();
    const hoy = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const cfg = await this.config();
    const rango: string[] = [];
    if (cfg.selSaleDateFrom) rango.push(`AND l."saleDate" >= ${Number(cfg.selSaleDateFrom)}`);
    if (cfg.selSaleDateTo) rango.push(`AND l."saleDate" <= ${Number(cfg.selSaleDateTo)}`);

    // `vendido` es la etiqueta: sin precio de martillo el lote consume la misma
    // GPU y no aporta una sola fila entrenable. Se cuenta por grupo para que la
    // pantalla pueda ensenar el antes y el despues de marcar la casilla.
    const vendido = `EXISTS (SELECT 1 FROM auction_sale_results r
                              WHERE r.lot = l."lotNumber"
                                AND r.matched AND r."finalBid" > 0)`;

    const [fila] = (await this.prisma.$queryRawUnsafe(
      `SELECT
         count(*) FILTER (WHERE l."saleDate" >= ${hoy})::int AS "fechados",
         count(*) FILTER (WHERE l."saleDate" >= ${hoy} ${rango.join(' ')})::int AS "fechadosEnRango",
         count(*) FILTER (WHERE l."saleDate" IS NULL)::int   AS "futureSale",
         count(*) FILTER (WHERE l."saleDate" < ${hoy})::int  AS "yaSubastados",
         count(*)::int                                       AS "total",
         count(*) FILTER (WHERE l."saleDate" >= ${hoy} ${rango.join(' ')} AND ${vendido})::int
                                                             AS "fechadosEnRangoVendidos",
         count(*) FILTER (WHERE l."saleDate" IS NULL AND ${vendido})::int
                                                             AS "futureSaleVendidos",
         count(*) FILTER (WHERE l."saleDate" < ${hoy} AND ${vendido})::int
                                                             AS "yaSubastadosVendidos"
       FROM auction_listings l
       LEFT JOIN lot_image_vectors v ON v."lotNumber" = l."lotNumber"
      WHERE l."galleryCachedAt" IS NOT NULL
        AND v."lotNumber" IS NULL
        AND COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) > 0`,
    )) as {
      fechados: number; fechadosEnRango: number;
      futureSale: number; yaSubastados: number; total: number;
      fechadosEnRangoVendidos: number; futureSaleVendidos: number;
      yaSubastadosVendidos: number;
    }[];

    // Mismo criterio que `pending()` en data-sync: los grupos se suman y
    // `selSoldOnly` recorta cada uno. Si se cambia alli, se cambia aqui.
    const sol = cfg.selSoldOnly;
    const seleccionados =
      (cfg.selDated ? (sol ? fila.fechadosEnRangoVendidos : fila.fechadosEnRango) : 0) +
      (cfg.selFutureSale ? (sol ? fila.futureSaleVendidos : fila.futureSale) : 0) +
      (cfg.selIncludePast ? (sol ? fila.yaSubastadosVendidos : fila.yaSubastados) : 0);

    return { ...fila, seleccionados, hoy };
  }

  /**
   * Pausa la ejecucion en curso.
   *
   * No hay nada que "reanudar" porque no hay nada que perder: los vectores se
   * escriben trozo a trozo segun llegan, y la cola es "lo que aun no tiene
   * vector". Parar y volver a lanzar retoma exactamente donde iba, sin repetir
   * una sola imagen ya pagada.
   */
  async pauseRun() {
    const activa = await this.prisma.embedJobRun.findFirst({
      where: { status: { in: ['pending', 'provisioning', 'running'] } },
      orderBy: { startedAt: 'desc' },
    });
    if (!activa) return { ok: false, motivo: 'No hay ninguna ejecucion en curso' };

    let podBorrado = false;
    if (activa.podId) {
      podBorrado = await this.runpod.deletePod(activa.podId).catch(() => false);
    }
    await this.prisma.embedJobRun.update({
      where: { id: activa.id },
      data: {
        status: 'aborted',
        finishedAt: new Date(),
        terminatedAt: new Date(),
        terminatedBy: 'manual',
        log: `${activa.log ?? ''}[pausa] parado desde la pantalla; los ${activa.lotsDone} lotes ya procesados quedan guardados\n`,
      },
    });
    return { ok: true, lotesHechos: activa.lotsDone, podBorrado };
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

  // ─────────── El ciclo completo: embeber y despues entrenar ───────────

  /**
   * La etiqueta que llevaran los vectores que se calculen ahora.
   *
   * Sale del fichero que acompana al PCA que se le sirve al pod, no de una
   * constante: si algun dia se cambia el PCA y aqui se sigue diciendo
   * "mean-64d", el ciclo daria por buenos vectores que ya no significan lo
   * mismo y no habria ningun error que lo delatara.
   */
  pcaActivo(cfg: { pooling: string }): { pcaVersion: string; pooling: string } {
    const meta = leerMetaPca(cfg.pooling);
    return { pcaVersion: meta.pcaVersion, pooling: meta.pooling };
  }

  /** `saleDate` es YYYYMMDD; 0 dias significa sin corte. */
  private corteVentana(windowDays: number): number | null {
    if (!windowDays || windowDays <= 0) return null;
    const d = new Date(Date.now() - windowDays * 86_400_000);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  /**
   * De cuantos lotes habla un ciclo con esta ventana.
   *
   * Un lote esta resuelto si tiene vector de la agrupacion activa O una lapida
   * (`dims = 0`, sus fotos no estan en B2). Sin la segunda condicion, los lotes
   * irrecuperables volverian a la cola en cada ciclo para siempre.
   */
  private scopeCache: { clave: string; at: number; data: any } | null = null;

  async rebuildScope(windowDays: number, pcaVersion: string) {
    // La consulta cruza 88.000 listings contra las ventas y tarda ~2,3 s. La
    // pantalla la pide cada 5 s mientras hay un ciclo vivo, asi que sin cache
    // son dos segundos de base de datos por cada pestaña abierta. Lo que mide
    // cambia al ritmo de la GPU —minutos— no al del sondeo.
    const clave = `${windowDays}|${pcaVersion}`;
    if (this.scopeCache && this.scopeCache.clave === clave
        && Date.now() - this.scopeCache.at < 60_000) {
      return this.scopeCache.data;
    }
    const corte = this.corteVentana(windowDays);
    const [fila] = (await this.prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS "enVentana",
              count(*) FILTER (
                WHERE NOT EXISTS (
                  SELECT 1 FROM lot_image_vectors v
                   WHERE v."lotNumber" = l."lotNumber"
                     AND (v.dims = 0 OR v."pcaVersion" = $1)
                )
              )::int AS "pendientes"
         FROM auction_listings l
        WHERE l."galleryCachedAt" IS NOT NULL
          AND COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) > 0
          AND EXISTS (
            SELECT 1 FROM auction_sale_results r
             WHERE r.lot = l."lotNumber" AND r.matched AND r."finalBid" > 0
               ${corte ? `AND r."saleDate" >= ${corte}` : ''}
          )`,
      pcaVersion,
    )) as { enVentana: number; pendientes: number }[];
    const data = { ...fila, corte };
    this.scopeCache = { clave, at: Date.now(), data };
    return data;
  }

  /**
   * Encola un ciclo. Quien lo ejecuta es data-sync, que es donde viven los
   * crons y la maquinaria de pods; aqui solo se deja la peticion y el registro.
   */
  async startRebuild(opts: { windowDays?: number; trigger?: string } = {}) {
    const cfg = await this.config();
    const enCurso = await this.prisma.modelRebuildRun.findFirst({
      where: { status: { in: ['queued', 'embedding', 'training'] } },
    });
    if (enCurso) return { ok: false, motivo: 'Ya hay un ciclo en curso', run: enCurso };

    const windowDays = opts.windowDays === undefined
      ? cfg.trainingDays
      : Math.max(0, opts.windowDays);
    const { pcaVersion, pooling } = this.pcaActivo(cfg);
    const scope = await this.rebuildScope(windowDays, pcaVersion);

    const run = await this.prisma.modelRebuildRun.create({
      data: {
        status: 'queued',
        trigger: opts.trigger ?? 'manual',
        windowDays, pooling, pcaVersion,
        lotsTarget: scope.pendientes,
        log:
          `[${new Date().toISOString()}] ciclo pedido: ventana ${windowDays || 'completa'}, ` +
          `agrupacion ${pooling} (${pcaVersion}); ${scope.enVentana} lotes en la ventana, ` +
          `${scope.pendientes} sin vector\n`,
      },
    });
    return { ok: true, run, scope };
  }

  /**
   * Para el ciclo donde este: la tanda de pod en curso o el entrenamiento.
   *
   * Nada de lo hecho se pierde — los vectores se guardan trozo a trozo — asi que
   * volver a lanzarlo retoma por donde iba.
   */
  async cancelRebuild() {
    const run = await this.prisma.modelRebuildRun.findFirst({
      where: { status: { in: ['queued', 'embedding', 'training'] } },
      orderBy: { startedAt: 'desc' },
    });
    if (!run) return { ok: false, motivo: 'No hay ningun ciclo en curso' };

    if (run.status === 'embedding') await this.pauseRun().catch(() => undefined);
    if (run.status === 'training') await this.cancelTraining().catch(() => undefined);

    await this.prisma.modelRebuildRun.update({
      where: { id: run.id },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        log: `${run.log ?? ''}[${new Date().toISOString()}] cancelado desde la pantalla; ` +
             `los ${run.lotsDone} lotes embebidos quedan guardados\n`,
      },
    });
    return { ok: true, lotesHechos: run.lotsDone };
  }

  /**
   * Retoma un ciclo detenido en vez de empezar otro.
   *
   * Hay dos maneras de que un ciclo se pare y solo una se arregla sola: si el
   * pod muere, la maquina de estados levanta otra tanda al minuto siguiente. Lo
   * que no tenia salida era lo demas —tope de gasto alcanzado, cancelado a mano,
   * entrenamiento fallido—, donde el ciclo quedaba cerrado y la unica opcion era
   * lanzar uno nuevo: fila nueva, historial partido en dos y el motivo original
   * enterrado.
   *
   * Reanudar es solo devolverlo a la cola. No repite trabajo: la cola es "lo que
   * aun no tiene vector de esta agrupacion", asi que los lotes ya embebidos
   * quedan fuera por definicion.
   */
  async resumeRebuild(id?: string) {
    const activo = await this.prisma.modelRebuildRun.findFirst({
      where: { status: { in: ['queued', 'embedding', 'training'] } },
    });
    if (activo) return { ok: false, motivo: 'Ya hay un ciclo en curso', run: activo };

    const run = id
      ? await this.prisma.modelRebuildRun.findUnique({ where: { id } })
      : await this.prisma.modelRebuildRun.findFirst({
          where: { status: { in: ['failed', 'cancelled'] } },
          orderBy: { startedAt: 'desc' },
        });
    if (!run) return { ok: false, motivo: 'No hay ningun ciclo detenido que reanudar' };

    // El tope de gasto es la razon mas probable de que se parara. Reanudar sin
    // subirlo primero lo mataria en el mismo sitio, y la pantalla habria dicho
    // "reanudado" para nada.
    const cfg = await this.config();
    const gastado = Number(run.costUsd ?? 0);
    const tope = Number(cfg.maxCostUsdPerRebuild);
    if (gastado >= tope) {
      return {
        ok: false,
        motivo: `Este ciclo ya lleva $${gastado.toFixed(2)} y el tope por ciclo es ` +
                `$${tope.toFixed(2)}. Sube el tope antes de reanudar o se parara igual.`,
        run,
      };
    }

    const { pcaVersion } = this.pcaActivo(cfg);
    const scope = await this.rebuildScope(run.windowDays, run.pcaVersion ?? pcaVersion);

    const actualizado = await this.prisma.modelRebuildRun.update({
      where: { id: run.id },
      data: {
        status: 'queued',
        error: null,
        finishedAt: null,
        log: `${run.log ?? ''}[${new Date().toISOString()}] reanudado a mano: ` +
             `${run.lotsDone} lotes ya embebidos, ${scope.pendientes} pendientes\n`,
      },
    });
    return { ok: true, run: actualizado, scope };
  }

  /**
   * Lo que pinta el bloque del ciclo: el activo, el historial y el alcance de ahora.
   *
   * El alcance es una consulta de 3,4 s que agrega 96.000 listings contra las
   * ventas; lo demas son lecturas de milisegundos. Iban juntas en un
   * `Promise.all`, asi que un fallo de la pesada dejaba la pantalla entera sin
   * ciclo, sin ajustes y sin historial — y el usuario leyendo "todavia no se ha
   * ejecutado ningun ciclo" con uno vivo por detras. Ahora la pesada puede
   * fallar sola y lo barato llega igual.
   */
  async rebuildStatus() {
    const cfg = await this.config();
    const { pcaVersion, pooling } = this.pcaActivo(cfg);
    const [activo, ultimos] = await Promise.all([
      this.prisma.modelRebuildRun.findFirst({
        where: { status: { in: ['queued', 'embedding', 'training'] } },
        orderBy: { startedAt: 'desc' },
      }),
      this.prisma.modelRebuildRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 }),
    ]);
    const scope = await this.rebuildScope(cfg.trainingDays, pcaVersion).catch((e) => {
      this.logger.error(`[Rebuild] alcance de la ventana fallo: ${e.message}`);
      return null;
    });

    // La tanda de pod que esta corriendo ahora mismo para este ciclo, si la hay:
    // es de donde sale el "va por X de Y" mientras embebe.
    const tanda = activo
      ? await this.prisma.embedJobRun.findFirst({
          where: { rebuildId: activo.id, status: { in: ['pending', 'provisioning', 'running'] } },
          orderBy: { startedAt: 'desc' },
        })
      : null;

    // El ultimo ciclo detenido es el candidato a reanudar. Se calcula aqui y no
    // en la pantalla para que el boton sepa cuanto queda sin tener que adivinar.
    const parado = !activo
      ? ultimos.find((r) => r.status === 'failed' || r.status === 'cancelled') ?? null
      : null;
    const reanudable = parado
      ? {
          id: parado.id,
          status: parado.status,
          lotsDone: parado.lotsDone,
          error: parado.error,
          pendientes: await this.rebuildScope(
            parado.windowDays, parado.pcaVersion ?? pcaVersion,
          ).then((r) => r.pendientes).catch(() => 0),
        }
      : null;

    // Lo que le queda AL CICLO ACTIVO, recalculado: su `lotsTarget` es una foto
    // del arranque y la ventana es movil, asi que el objetivo envejece mientras
    // el ciclo corre. Sin esto la barra puede pasar del 100% y seguir habiendo
    // trabajo, que es justo lo que confunde.
    const pendientesActivo = activo
      ? await this.rebuildScope(activo.windowDays, activo.pcaVersion ?? pcaVersion)
          .then((r) => r.pendientes)
          .catch(() => null)
      : null;

    return {
      activo, tanda, ultimos, scope, reanudable, pendientesActivo,
      config: {
        pooling, pcaVersion, imgSlots: cfg.imgSlots,
        windowDays: cfg.trainingDays,
        autoRebuildEnabled: cfg.autoRebuildEnabled,
        autoRebuildEveryDays: cfg.autoRebuildEveryDays,
        autoRebuildHour: cfg.autoRebuildHour,
        lastAutoRebuildAt: cfg.lastAutoRebuildAt,
        maxCostUsdPerRebuild: cfg.maxCostUsdPerRebuild,
      },
    };
  }

  // ─────────── Lo que llama el pod ───────────

  /**
   * El manifiesto, PAGINADO POR LOTE.
   *
   * Antes devolvia todo de golpe y con 200.000 lotes eran 1,8 millones de items:
   * el worker los acumulaba en memoria junto con sus embeddings (11 GB) y el pod
   * moria a los cuatro minutos. Ahora el worker pide trozos y envia los vectores
   * de cada uno antes de pedir el siguiente, asi que la memoria queda acotada por
   * el tamaño del trozo y no por el del trabajo.
   *
   * Se pagina por LOTE y no por imagen para que las fotos de un coche nunca
   * queden partidas entre dos trozos: el vector es el promedio de todas, y un
   * lote a medias daria un vector distinto del que daria completo.
   */
  async manifest(runId: string, maxSeq = 9, offset = 0, lots = 2000) {
    const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Ejecucion no encontrada');

    // ── Una tanda de ciclo pide OTRA cosa ──
    // El pod saca su trabajo de aqui, no de la lista que calculo data-sync. Con
    // la consulta de siempre, una tanda de ciclo embebia el pendiente global
    // —ignorando la ventana— y, peor, nunca veia los lotes que ya tienen vector
    // de OTRA agrupacion: para esta consulta ya estaban hechos. El ciclo pedia
    // 88.467 lotes que el pod no podia entregar jamas, y habria encadenado
    // tandas hasta el tope de gasto sin llegar nunca a cero.
    if (run.rebuildId) {
      return this.manifestRebuild(run.rebuildId, runId, maxSeq, lots);
    }

    const filas = (await this.prisma.$queryRawUnsafe(
      `WITH elegidos AS (
         SELECT l."lotNumber", l."galleryCache"
           FROM auction_listings l
           LEFT JOIN lot_image_vectors v ON v."lotNumber" = l."lotNumber"
          WHERE l."galleryCachedAt" IS NOT NULL AND v."lotNumber" IS NULL
          ORDER BY l."saleDate" ASC NULLS LAST, l."lotNumber"
          OFFSET $1 LIMIT $2
       )
       SELECT e."lotNumber"::text AS lot, (img->>'sequence')::int AS seq
         FROM elegidos e
         CROSS JOIN LATERAL json_array_elements(e."galleryCache"::json->'images') AS img
        WHERE (img->>'sequence')::int <= $3
        ORDER BY e."lotNumber", 2`,
      offset,
      Math.min(Math.max(lots, 1), 5000),
      maxSeq,
    )) as { lot: string; seq: number }[];

    return {
      runId,
      offset,
      lots,
      agotado: filas.length === 0,
      // La clave se construye aqui y no en el pod para que el formato viva en un
      // solo sitio (lo escribe gallery-cache.service.ts al subir a B2).
      items: filas.map((f) => ({ lot: f.lot, seq: f.seq, key: `gallery/${f.lot}/${f.seq}_hrs.jpg` })),
    };
  }

  /**
   * El manifiesto de una tanda que pertenece a un ciclo.
   *
   * Mismo criterio que `pendingRebuild` en data-sync: vendido con precio dentro
   * de la ventana, y sin vector de la agrupacion del ciclo — un vector `mean`
   * NO cuenta cuando el ciclo produce `slots`.
   *
   * ── Sin OFFSET, a proposito ──
   * El pod pagina sumando el tamaño del trozo, pero los lotes que ya tienen
   * vector desaparecen de esta consulta segun se van guardando. Con OFFSET, el
   * trozo 2 empezaba 1.000 filas mas alla de donde debia y se saltaba mil lotes
   * en cada vuelta. Como los procesados salen solos del conjunto, devolver
   * siempre los primeros pendientes avanza sin huecos y sin repetir.
   */
  private async manifestRebuild(rebuildId: string, runId: string, maxSeq: number, lots: number) {
    const ciclo = await this.prisma.modelRebuildRun.findUnique({ where: { id: rebuildId } });
    if (!ciclo) throw new NotFoundException('Ciclo no encontrado');
    const corte = this.corteVentana(ciclo.windowDays);
    const pca = ciclo.pcaVersion ?? 'mean-64d';

    const filas = (await this.prisma.$queryRawUnsafe(
      `WITH elegidos AS (
         SELECT l."lotNumber", l."galleryCache",
                (SELECT max(r."saleDate") FROM auction_sale_results r
                  WHERE r.lot = l."lotNumber" AND r.matched AND r."finalBid" > 0) AS sd
           FROM auction_listings l
          WHERE l."galleryCachedAt" IS NOT NULL
            AND COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) > 0
            AND EXISTS (
              SELECT 1 FROM auction_sale_results r
               WHERE r.lot = l."lotNumber" AND r.matched AND r."finalBid" > 0
                 ${corte ? `AND r."saleDate" >= ${corte}` : ''}
            )
            AND NOT EXISTS (
              SELECT 1 FROM lot_image_vectors v
               WHERE v."lotNumber" = l."lotNumber"
                 AND (v.dims = 0 OR v."pcaVersion" = $1)
            )
          ORDER BY sd DESC NULLS LAST, l."lotNumber"
          LIMIT $2
       )
       SELECT e."lotNumber"::text AS lot, (img->>'sequence')::int AS seq
         FROM elegidos e
         CROSS JOIN LATERAL json_array_elements(e."galleryCache"::json->'images') AS img
        WHERE (img->>'sequence')::int <= $3
        ORDER BY e."lotNumber", 2`,
      pca,
      Math.min(Math.max(lots, 1), 5000),
      maxSeq,
    )) as { lot: string; seq: number }[];

    return {
      runId,
      offset: 0,
      lots,
      agotado: filas.length === 0,
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
      data: { lotsDone: { increment: guardados }, lastSeenAt: new Date() },
    }).catch(() => undefined);
    return { guardados };
  }

  async complete(
    runId: string,
    body: {
      imagesDone?: number; imagesFailed?: number; error?: string;
      lotsWithoutImages?: string[];
      /** true cuando el pod solo manda lapidas de un trozo y sigue trabajando. */
      parcial?: boolean;
    },
  ) {
    // Lapidas para los lotes cuyas fotos no estan en B2 pese a que
    // `galleryCachedAt` dice que si (objetos que no sobrevivieron a la migracion
    // desde Spaces). Sin esto vuelven a la cola cada noche y se reintentan para
    // siempre: 71 de 502 en la primera ejecucion real.
    const huecos = body.lotsWithoutImages ?? [];
    if (huecos.length) {
      await this.prisma.lotImageVector
        .createMany({
          data: huecos.map((lot) => ({
            lotNumber: BigInt(lot), vector: Buffer.alloc(0), dims: 0,
            encoder: 'sin-imagenes', pcaVersion: 'n/a', imageCount: 0,
          })),
          skipDuplicates: true,
        })
        .catch((e) => this.logger.warn(`[EmbedJobs] lapidas: ${e.message}`));
      this.logger.warn(`[EmbedJobs] ${huecos.length} lotes marcados sin imagen en B2`);
      await this.appendLog(runId, `${huecos.length} lotes marcados como "sin imagen en B2": no volveran a la cola`);
    }

    // Un aviso parcial solo trae lapidas de un trozo: el pod sigue vivo y
    // cerrar la ejecucion aqui la daria por terminada a mitad.
    if (body.parcial) return { ok: true, parcial: true };

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

  // ─────────── Reentrenamiento del modelo ───────────

  /**
   * Lanza el reentrenamiento sobre una ventana movil de dias.
   *
   * Entrena el contenedor de ML, que es quien tiene LightGBM y un usuario de
   * Postgres de SOLO LECTURA para el caso. Aqui solo se dispara y se lleva el
   * registro, porque el historial de que modelo gano a cual es auditoria y debe
   * sobrevivir a que el contenedor se reinicie.
   */
  async startTraining(opts: {
    days?: number;
    force?: boolean;
    onlyWithImages?: boolean;
    autoPromote?: boolean;
  } = {}) {
    const cfg = await this.config();
    const enCurso = await this.prisma.modelTrainingRun.findFirst({
      where: { status: { in: ['pending', 'running'] } },
    });
    if (enCurso) return { ok: false, motivo: 'Ya hay un entrenamiento en curso', run: enCurso };

    // `days: 0` es una peticion legitima —todo el historico—, asi que no puede
    // caer en el `??` y convertirse en la ventana de la config.
    const dias = opts.days === undefined ? cfg.trainingDays : Math.max(0, opts.days);
    const soloConImagenes = opts.onlyWithImages ?? cfg.trainingOnlyWithImages;
    const autoPromote = opts.autoPromote ?? cfg.autoPromote;
    const force = opts.force === true;

    const run = await this.prisma.modelTrainingRun.create({
      data: { status: 'running', trainingDays: dias, onlyWithImages: soloConImagenes },
    });

    try {
      const res = await fetch(`${ML_URL}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: dias, autoPromote, force, onlyWithImages: soloConImagenes,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (!body.ok) {
        await this.prisma.modelTrainingRun.update({
          where: { id: run.id },
          data: { status: 'failed', error: body.error ?? 'el servicio lo rechazo', finishedAt: new Date() },
        });
        return { ok: false, motivo: body.error ?? 'el servicio lo rechazo', run };
      }
    } catch (err: any) {
      await this.prisma.modelTrainingRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: err.message, finishedAt: new Date() },
      });
      return { ok: false, motivo: `No responde el servicio de modelo: ${err.message}`, run };
    }

    await this.prisma.embedJobConfig.update({
      where: { id: CONFIG_ID }, data: { lastTrainingAt: new Date() },
    });
    return { ok: true, run };
  }

  /**
   * Sondea el entrenamiento y, al terminar, vuelca el resultado a la fila.
   *
   * El estado vive en la memoria del contenedor de ML; esto lo persiste para que
   * el historial no dependa de que ese proceso siga en pie.
   */
  async trainingStatus() {
    const run = await this.prisma.modelTrainingRun.findFirst({
      orderBy: { startedAt: 'desc' },
    });

    let vivo: any = null;
    try {
      const res = await fetch(`${ML_URL}/train/status`, { signal: AbortSignal.timeout(8000) });
      vivo = res.ok ? await res.json() : null;
    } catch {
      /* el servicio puede estar reiniciando; el historial en BD sigue valiendo */
    }

    if (run && run.status === 'running' && vivo && !vivo.running && vivo.result) {
      const r = vivo.result;
      await this.prisma.modelTrainingRun.update({
        where: { id: run.id },
        data: {
          // Cancelar no es fallar: el modelo que sirve quedo intacto y no hay
          // nada que investigar. Mezclarlos ensucia el historial de auditoria.
          status: r.cancelled ? 'cancelled' : r.error ? 'failed' : 'done',
          finishedAt: new Date(),
          error: r.error ?? null,
          rowsTrain: r.rowsTrain ?? null,
          rowsValid: r.rowsValid ?? null,
          rowsWithImages: r.rowsWithImages ?? null,
          maeChampion: r.maeChampion ?? null,
          maeChallenger: r.maeChallenger ?? null,
          maeBaseline: r.maeBaseline ?? null,
          intervalCoverage: r.intervalCoverage ?? null,
          promoted: !!r.promoted,
          promotedReason: r.promotedReason ?? null,
          modelVersion: r.modelVersion ?? null,
          log: (vivo.log ?? []).join('\n').slice(-40_000),
        },
      });
    }

    const [ultimas, cfg, corpus] = await Promise.all([
      this.prisma.modelTrainingRun.findMany({ orderBy: { startedAt: 'desc' }, take: 15 }),
      this.config(),
      this.corpus(),
    ]);
    return {
      corriendo: !!vivo?.running,
      cancelando: !!vivo?.cancelling,
      progreso: vivo?.progress ?? null,
      // El log completo mientras corre: es lo unico que cuenta que esta pasando
      // dentro de los minutos que tarda.
      logVivo: vivo?.running ? (vivo.log ?? []).slice(-80) : [],
      modeloServido: vivo?.modelVersion ?? null,
      /** Lo que el modelo que sirve sabe de si mismo: version, MAE, si mira fotos. */
      salud: vivo?.health ?? null,
      servicioCaido: vivo === null,
      corpus,
      config: {
        trainingDays: cfg.trainingDays,
        autoPromote: cfg.autoPromote,
        trainingOnlyWithImages: cfg.trainingOnlyWithImages,
        lastTrainingAt: cfg.lastTrainingAt,
      },
      ejecuciones: ultimas,
    };
  }

  /**
   * De que material dispone el entrenamiento ahora mismo.
   *
   * Es la cifra que decide si tiene sentido pulsar "entrenar": el modelo visor
   * solo puede aprender de ventas cuyo lote tenga vector, y esas son hoy una
   * fraccion de las ventas con precio. Sin verlo, se entrena con 8.000 filas
   * creyendo que son 174.000.
   */
  private corpusCache: { clave: string; at: number; data: any } | null = null;

  async corpus() {
    // Un vector de OTRA agrupacion no cuenta como material: tiene las mismas 64
    // columnas y significa otra cosa. Contarlo dice "corpus procesado" mientras
    // el modelo visor todavia no tiene con que entrenar.
    const cfg = await this.config();
    const { pcaVersion } = this.pcaActivo(cfg);

    // La consulta agrega 184.000 filas y la pantalla sondea cada 20 s: un minuto
    // de cache la deja en una vez por refresco largo sin envejecer de verdad.
    if (this.corpusCache && this.corpusCache.clave === pcaVersion
        && Date.now() - this.corpusCache.at < 60_000) {
      return this.corpusCache.data;
    }
    const [fila] = (await this.prisma.$queryRawUnsafe(
      `SELECT
         count(*)::int                        AS "ventas",
         count(DISTINCT s.lot)::int           AS "lotes",
         count(DISTINCT s.lot) FILTER (
           WHERE l."galleryCachedAt" IS NOT NULL
             AND COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) > 0
         )::int                               AS "lotesConFotos",
         count(DISTINCT s.lot) FILTER (
           WHERE v."pcaVersion" = $1 AND v.dims > 0
         )::int                               AS "lotesConVector",
         count(*) FILTER (
           WHERE v."pcaVersion" = $1 AND v.dims > 0
         )::int                               AS "ventasConVector",
         min(s."saleDate")::int               AS "desde",
         max(s."saleDate")::int               AS "hasta"
       FROM auction_sale_results s
       LEFT JOIN auction_listings l  ON l."lotNumber" = s.lot
       LEFT JOIN lot_image_vectors v ON v."lotNumber" = s.lot
      WHERE s.matched AND s."finalBid" IS NOT NULL AND s."finalBid" > 0`,
      pcaVersion,
    )) as any[];

    const data = {
      ...fila,
      pcaVersion,
      /** Lotes vendidos con fotos sin vector de la agrupacion activa. */
      lotesPendientes: Math.max(0, (fila?.lotesConFotos ?? 0) - (fila?.lotesConVector ?? 0)),
    };
    this.corpusCache = { clave: pcaVersion, at: Date.now(), data };
    return data;
  }

  /**
   * Para el entrenamiento en curso.
   *
   * El contenedor de ML lo atiende en el proximo arbol. No deshace nada: el
   * modelo que sirve solo cambia al final y solo si gana, asi que cancelar a
   * mitad deja produccion exactamente como estaba.
   */
  async cancelTraining() {
    const run = await this.prisma.modelTrainingRun.findFirst({
      where: { status: { in: ['pending', 'running'] } },
      orderBy: { startedAt: 'desc' },
    });
    try {
      const res = await fetch(`${ML_URL}/train/cancel`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json();
      if (!body.ok && !run) return { ok: false, motivo: 'No hay ningun entrenamiento en curso' };
    } catch (err: any) {
      return { ok: false, motivo: `No responde el servicio de modelo: ${err.message}` };
    }
    // La fila se cierra cuando el sondeo vea que el servicio ya no corre; aqui
    // solo se deja constancia de que alguien lo pidio.
    if (run) {
      await this.prisma.modelTrainingRun.update({
        where: { id: run.id },
        data: { log: `${run.log ?? ''}[cancelacion pedida desde la pantalla]\n` },
      }).catch(() => undefined);
    }
    return { ok: true };
  }

  async appendLog(runId: string, linea: string) {
    const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
    if (!run) return;
    const log = `${run.log ?? ''}[${new Date().toISOString()}] ${linea}\n`;
    await this.prisma.embedJobRun
      // `lastSeenAt` is the pod's heartbeat: the boot sweep in data-sync uses it
      // to tell a pod orphaned by a crash from one that is simply outliving a
      // redeploy of this backend.
      .update({ where: { id: runId }, data: { log: log.slice(-40_000), lastSeenAt: new Date() } })
      .catch(() => undefined);
  }
}
