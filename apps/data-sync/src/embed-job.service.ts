import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { RunpodService, PublicS3Service, mapWithConcurrency, leerMetaPca } from '@htownautos/common';

/** El servicio del modelo vive en su propio contenedor, fuera de Coolify. */
const ML_URL = process.env.ML_SERVICE_URL ?? 'http://htownautos-ml:8000';

const CONFIG_ID = 'singleton';
/** Prefijo por el que el vigilante reconoce NUESTROS pods y no toca los ajenos. */
export const POD_PREFIX = 'htownautos-embed';
const POLL_MS = 20_000;
/**
 * Silencio a partir del cual un pod se da por huerfano al arrancar el servicio.
 *
 * El pod habla solo: el bootstrap manda el log cada 10 s y el worker imprime
 * cada 20 tandas, asi que en marcha escribe cada minuto y medio o dos. Quince
 * minutos es muy por encima de ese ritmo y deja margen para el arranque, donde
 * se baja el modelo y hay un hueco sin lineas.
 */
const SILENCIO_HUERFANO_MIN = 15;
/**
 * Tope duro de vida de un pod, pase lo que pase en la config.
 *
 * Vive aqui y no en el vigilante porque es quien crea el pod el que tiene que
 * respetarlo: si el pod cree que tiene mas tiempo del que el vigilante le va a
 * dejar, planifica trozos que no le caben y muere a mitad de uno.
 */
export const TOPE_DURO_MIN = 360;
/** Margen para que el worker cierre y reporte antes de que lo corten. */
const MARGEN_CIERRE_MIN = 15;

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
    private readonly s3: PublicS3Service,
  ) {}

  /**
   * Comprueba en B2 que las fotos existen de verdad, ANTES de alquilar la GPU.
   *
   * `galleryCachedAt` miente: hay lotes antiguos marcados como cacheados cuyos
   * objetos no sobrevivieron a la migracion desde DigitalOcean Spaces. En la
   * primera ejecucion real fueron 71 de 502 —el 14%— y se descubrieron ya con la
   * GPU en marcha, pagando por bajar cosas que no estaban.
   *
   * Se mira SOLO la primera foto de cada lote: el fallo observado es de lote
   * entero (427 lotes salieron con sus 9 fotos y 71 fallaron completos), asi que
   * una comprobacion por lote basta y son 20.000 peticiones en vez de 180.000.
   *
   * Los que no existen se marcan aqui mismo para que no vuelvan a la cola.
   */
  async validarEnB2(
    lotes: { lot: bigint; imageCount: number }[],
  ): Promise<{ ok: { lot: bigint; imageCount: number }[]; sinFotos: bigint[] }> {
    const resultados = await mapWithConcurrency(lotes, 64, async (l) => {
      try {
        const r = await this.s3.headObject(`gallery/${l.lot.toString()}/1_hrs.jpg`);
        return { l, existe: r.exists };
      } catch {
        // Un error de red no es prueba de que falte: se deja pasar y, si acaso,
        // fallara en el pod. Marcar por error de red perderia lotes buenos.
        return { l, existe: true };
      }
    });

    // mapWithConcurrency refleja Promise.allSettled: nunca rechaza, devuelve el
    // estado de cada elemento. Un rechazo aqui se trata como "existe" — marcar un
    // lote por un fallo de red perderia fotos buenas para siempre.
    const ok: { lot: bigint; imageCount: number }[] = [];
    const sinFotos: bigint[] = [];
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled' && !r.value.existe) sinFotos.push(lotes[i].lot);
      else ok.push(lotes[i]);
    });
    return { ok, sinFotos };
  }

  /** Marca lotes cuyas fotos no estan en B2 para que no vuelvan a la cola. */
  private async marcarSinFotos(lotes: bigint[]): Promise<void> {
    if (!lotes.length) return;
    await this.prisma.lotImageVector
      .createMany({
        data: lotes.map((lot) => ({
          lotNumber: lot, vector: Buffer.alloc(0), dims: 0,
          encoder: 'sin-imagenes', pcaVersion: 'n/a', imageCount: 0,
        })),
        skipDuplicates: true,
      })
      .catch((e) => this.logger.warn(`[EmbedJob] marcar sin fotos: ${e.message}`));
  }

  /**
   * Al arrancar el servicio, decide que hacer con los pods que siguen vivos.
   *
   * ── Por que no basta con apagarlos todos ──
   * La primera version daba por huerfano cualquier pod cuya ejecucion siguiera
   * en `running`, razonando que si el backend se reinicio el pod quedo suelto.
   * Es falso: el pod es una maquina independiente que no se entera de que este
   * contenedor se redespliega, y sigue trabajando y reportando por la API. Un
   * deploy en horario normal bastaba para tirar una ejecucion sana.
   *
   * Paso el 2026-09-16: un deploy mato una ejecucion de 3 h 57 min CINCO
   * SEGUNDOS despues de su ultima linea de progreso. Los 16.000 vectores ya
   * subidos sobrevivieron —el worker los manda por trozos, no al final— asi que
   * no se perdio el trabajo hecho, pero si el pod que estaba en marcha y los
   * minutos de GPU ya pagados del trozo a medias.
   *
   * Lo que de verdad separa un pod huerfano de uno sano no es si nosotros nos
   * reiniciamos, sino si EL sigue hablando. `lastSeenAt` lo dice: lo escribe el
   * pod en cada linea de log y en cada tanda de vectores.
   *
   * Un pod adoptado se vuelve a supervisar de inmediato. Sin eso quedaria
   * corriendo sin plazo ni tope de coste, que es peor que matarlo.
   */
  async onModuleInit(): Promise<void> {
    const vivas = await this.prisma.embedJobRun.findMany({
      where: { status: { in: ['provisioning', 'running'] }, podId: { not: null } },
    });
    for (const r of vivas) {
      const visto = r.lastSeenAt ?? r.podReadyAt ?? r.startedAt;
      const silencioMin = (Date.now() - visto.getTime()) / 60_000;

      if (silencioMin > SILENCIO_HUERFANO_MIN) {
        this.logger.warn(
          `[EmbedJob] ejecucion ${r.id} muda desde hace ${silencioMin.toFixed(0)} min; apagando pod ${r.podId}`,
        );
        await this.terminate(
          r.id, r.podId!, 'boot',
          `Sin señales del pod en ${silencioMin.toFixed(0)} min tras reiniciarse el servicio`,
        );
        continue;
      }

      this.logger.log(
        `[EmbedJob] ejecucion ${r.id} sigue viva (ultima señal hace ${silencioMin.toFixed(1)} min); retomando supervision`,
      );
      await this.append(
        r.id,
        `el servicio se reinicio; el pod seguia trabajando (ultima señal hace ` +
        `${silencioMin.toFixed(1)} min) y se retoma la supervision`,
      );
      void this.retomar(r.id, r.podId!);
    }
  }

  /**
   * Vuelve a poner un pod adoptado bajo vigilancia.
   *
   * Se lanza sin esperar porque `onModuleInit` bloquea el arranque de Nest: si
   * esto se esperara, el servicio no terminaria de levantar hasta que el pod
   * acabase, horas despues.
   */
  private async retomar(runId: string, podId: string): Promise<void> {
    try {
      const cfg = await this.config();
      this.running = true;
      await this.poll(runId, podId, cfg);
    } catch (e) {
      this.logger.error(`[EmbedJob] supervision retomada de ${runId} fallo: ${(e as Error).message}`);
    } finally {
      this.running = false;
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
  /** Hoy como YYYYMMDD, que es como `saleDate` guarda las fechas. */
  private hoyInt(): number {
    const d = new Date();
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  }

  /**
   * Los lotes que entran en la proxima ejecucion.
   *
   * ── El orden es la mitad del trabajo ──
   * Antes era `saleDate ASC NULLS LAST`: lo mas viejo primero. Como el corpus
   * arrastra 218.066 lotes YA SUBASTADOS, la cola empezaba por ellos y los
   * coches que se van a pujar quedaban a unas quince noches de distancia, es
   * decir, despues de su propia subasta. Los Future Sale, que son el 63% de lo
   * que entra cada dia, caian los ultimos por el NULLS LAST.
   *
   * El orden correcto sale de para que sirve cada grupo:
   *   1. Fechados por subastar — la prediccion solo vale ANTES del martillo,
   *      y dentro del grupo primero el que subasta antes.
   *   2. Future Sale — venderan pronto, fecha pendiente.
   *   3. Ya subastados — no se puede pujar por ellos; valen como corpus de
   *      entrenamiento, y ahi el mas reciente primero porque el modelo solo
   *      mira una ventana de 90 dias.
   *
   * `selectionAll` salta los filtros para vaciar la cola sin tocar los ajustes.
   */
  async pending(
    limit: number,
    sel?: {
      selDated: boolean;
      selFutureSale: boolean;
      selIncludePast: boolean;
      selSaleDateFrom: number | null;
      selSaleDateTo: number | null;
      selSoldOnly: boolean;
    },
    todo = false,
  ): Promise<{ lot: bigint; imageCount: number }[]> {
    const hoy = this.hoyInt();
    const cond: string[] = [];

    if (!todo && sel) {
      const grupos: string[] = [];
      if (sel.selDated) {
        // El rango acota SOLO a los fechados: a un Future Sale no se le puede
        // exigir una fecha que todavia no tiene.
        const r = [`l."saleDate" >= ${hoy}`];
        if (sel.selSaleDateFrom) r.push(`l."saleDate" >= ${sel.selSaleDateFrom}`);
        if (sel.selSaleDateTo) r.push(`l."saleDate" <= ${sel.selSaleDateTo}`);
        grupos.push(`(${r.join(' AND ')})`);
      }
      if (sel.selFutureSale) grupos.push(`l."saleDate" IS NULL`);
      if (sel.selIncludePast) grupos.push(`l."saleDate" < ${hoy}`);
      // Sin ningun grupo marcado no hay nada que procesar: devolver la consulta
      // sin filtro seria mandar el corpus entero por accidente.
      if (!grupos.length) return [];
      cond.push(`(${grupos.join(' OR ')})`);
      // El corpus de entrenamiento necesita la etiqueta, y la etiqueta es el
      // precio. Un lote sin venta registrada consume la misma GPU y no aporta
      // una sola fila entrenable.
      if (sel.selSoldOnly) {
        cond.push(`EXISTS (SELECT 1 FROM auction_sale_results r
                            WHERE r.lot = l."lotNumber"
                              AND r.matched AND r."finalBid" > 0)`);
      }
    }

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
          ${cond.length ? `AND ${cond.join(' AND ')}` : ''}
        ORDER BY
          CASE WHEN l."saleDate" >= ${hoy} THEN 0
               WHEN l."saleDate" IS NULL   THEN 1
               ELSE 2 END ASC,
          CASE WHEN l."saleDate" >= ${hoy} THEN l."saleDate"
               ELSE -l."saleDate" END ASC NULLS LAST
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
   * Los lotes que le tocan a un CICLO, que no son los mismos que los del job
   * suelto.
   *
   * Dos diferencias que importan:
   *
   *  - El alcance es "vendido con precio final dentro de la ventana". Un lote
   *    sin precio no entrena nada, y uno fuera de la ventana no describe el
   *    mercado que se quiere modelar.
   *  - Un lote esta resuelto si tiene vector de ESTA agrupacion o una lapida
   *    (`dims = 0`, sus fotos no estan en B2). Al cambiar de `mean` a `slots`
   *    los vectores viejos siguen ahi y siguen teniendo 64 dimensiones, pero
   *    significan otra cosa: el ciclo tiene que volver a calcularlos.
   *
   * El orden es por venta mas reciente primero: si el ciclo se corta a medias,
   * lo que queda cubierto es el mercado de ahora y no el de hace dos meses.
   */
  async pendingRebuild(
    limit: number,
    windowDays: number,
    pcaVersion: string,
  ): Promise<{ lot: bigint; imageCount: number }[]> {
    const corte = windowDays > 0
      ? (() => {
          const d = new Date(Date.now() - windowDays * 86_400_000);
          return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        })()
      : null;

    const filas = (await this.prisma.$queryRawUnsafe(
      `SELECT l."lotNumber" AS lot,
              COALESCE((l."galleryCache"::json->>'imageCount')::int, 0) AS n,
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
               AND (v.dims = 0 OR v."pcaVersion" = $2)
          )
        ORDER BY sd DESC NULLS LAST
        LIMIT $1`,
      Math.max(1, limit),
      pcaVersion,
    )) as { lot: bigint; n: number }[];

    return filas.map((f) => ({ lot: f.lot, imageCount: Number(f.n) }));
  }

  /** Cuantos lotes le quedan al ciclo. Igual que `pendingRebuild` pero sin traerlos. */
  async countPendingRebuild(windowDays: number, pcaVersion: string): Promise<number> {
    const corte = windowDays > 0
      ? (() => {
          const d = new Date(Date.now() - windowDays * 86_400_000);
          return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
        })()
      : null;
    const filas = (await this.prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n
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
          )`,
      pcaVersion,
    )) as { n: number }[];
    return Number(filas[0]?.n ?? 0);
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
    const adoptada = adoptarId
      ? await this.prisma.embedJobRun.findUnique({ where: { id: adoptarId } })
      : null;
    const todo = adoptada?.selectionAll ?? false;

    // Una tanda de ciclo no mira los filtros de la config: sus lotes salen de la
    // ventana del ciclo. Mezclarlos daria una tanda que embebe Future Sales
    // mientras el ciclo espera lotes vendidos que nunca llegan.
    const ciclo = adoptada?.rebuildId
      ? await this.prisma.modelRebuildRun.findUnique({ where: { id: adoptada.rebuildId } })
      : null;
    const lotes = ciclo
      ? await this.pendingRebuild(cfg.maxLotsPerRun, ciclo.windowDays, ciclo.pcaVersion ?? 'mean-64d')
      : await this.pending(cfg.maxLotsPerRun, cfg, todo);
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

    // Validar ANTES de alquilar: es la diferencia entre descubrir que faltan
    // fotos gratis o descubrirlo con la GPU cobrando.
    this.logger.log(`[EmbedJob] validando ${lotes.length} lotes en B2...`);
    const { ok: validos, sinFotos } = await this.validarEnB2(lotes);
    await this.marcarSinFotos(sinFotos);
    if (sinFotos.length) {
      this.logger.warn(`[EmbedJob] ${sinFotos.length} lotes sin fotos en B2, marcados`);
    }
    if (!validos.length) {
      this.running = false;
      const msg = `Ninguno de los ${lotes.length} lotes tiene sus fotos en B2`;
      this.logger.warn(`[EmbedJob] ${msg}`);
      if (adoptarId) {
        await this.prisma.embedJobRun.update({
          where: { id: adoptarId },
          data: { status: 'done', finishedAt: new Date(), log: msg + '\n' },
        });
      }
      return null;
    }

    // ── Lo que de verdad dura un pod es el MENOR de los tres limites ──
    // La config los deja fijar por separado y es facil que se contradigan: con
    // `maxMinutes` en 600 el pod planifica diez horas mientras el vigilante lo
    // corta a las seis, y muere a mitad de un trozo perdiendo ese trabajo. Se
    // calcula aqui, una vez, y es ESTE numero el que viaja al pod.
    const minutosEfectivos = Math.min(cfg.maxMinutes, TOPE_DURO_MIN - MARGEN_CIERRE_MIN);
    if (minutosEfectivos < cfg.maxMinutes) {
      this.logger.warn(
        `[EmbedJob] maxMinutes=${cfg.maxMinutes} supera el tope duro; el pod usara ${minutosEfectivos} min`,
      );
    }

    const cabecera =
      `[${new Date().toISOString()}] ${origen}: ${lotes.length} pendientes, ` +
      `${validos.length} con fotos verificadas en B2` +
      (sinFotos.length ? `, ${sinFotos.length} marcados sin fotos` : '') + '\n';
    const run = adoptarId
      ? await this.prisma.embedJobRun.update({
          where: { id: adoptarId },
          data: { status: 'provisioning', lotsRequested: validos.length, log: cabecera },
        })
      : await this.prisma.embedJobRun.create({
          data: { status: 'provisioning', lotsRequested: validos.length, log: cabecera },
        });

    let podId: string | null = null;
    try {
      // El pod corre en RunPod, en internet abierto: NO puede resolver nombres de
      // la red interna de Docker. Esta URL tiene que ser publica o el pod arranca,
      // no consigue descargar nada, y se queda quieto cobrando hasta que salte
      // algun corta-circuitos. Paso exactamente eso la primera vez.
      // Se compara el HOST exacto, no un trozo de la cadena. La primera version
      // buscaba "//api" y rechazaba `https://api.htownautos.com` —la URL buena—
      // porque el dominio empieza igual que el nombre del servicio en Docker.
      const api = (process.env.EMBED_CALLBACK_URL ?? '').trim();
      let host = '';
      try {
        host = new URL(api).hostname;
      } catch {
        throw new Error(
          `EMBED_CALLBACK_URL no es una URL valida: "${api}". Debe ser la URL ` +
          'publica de la API, p. ej. https://api.htownautos.com/api/v1',
        );
      }
      // Un host sin punto solo puede ser un nombre de la red interna de Docker,
      // y el pod corre en internet abierto: no lo alcanzaria nunca.
      if (!host.includes('.') || host === 'localhost' || host.startsWith('127.')) {
        throw new Error(
          `EMBED_CALLBACK_URL apunta a "${host}", que es una direccion interna. ` +
          'El pod es externo y necesita la URL publica de la API.',
        );
      }
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
          MAX_MINUTES: String(minutosEfectivos),
        },
      });
      podId = pod.id;

      // `POST /pods` devuelve poco mas que el id: el modelo de GPU y el precio
      // hay que releerlos, o la pantalla muestra "?" en todas las ejecuciones.
      const detalle = await this.runpod.getPod(pod.id).catch(() => null);
      const gpu = detalle?.gpu?.displayName ?? detalle?.machine?.gpuDisplayName
        ?? pod.gpu?.displayName ?? null;
      const precio = detalle?.costPerHr ?? pod.costPerHr;

      await this.prisma.embedJobRun.update({
        where: { id: run.id },
        data: {
          podId: pod.id,
          podType: gpu,
          costPerHr: precio ? Number(precio) : null,
          status: 'running',
          podReadyAt: new Date(),
        },
      });
      await this.append(run.id, `pod ${pod.id} (${gpu ?? '?'}) a $${precio ?? '?'}/h`);

      // ── Devolver el pod si sale caro ──
      // `POST /pods` no admite ningun parametro de precio y `gpuTypePriority:
      // availability` optimiza por conseguir GPU, no por coste, asi que el
      // precio no se puede pedir: solo se puede mirar y rechazar. El mismo A40
      // ha salido a $0,27, a $0,49 y una vez a $1,59. Devolverlo aqui cuesta los
      // segundos que lleva crearlo y borrarlo.
      const tope = Number(cfg.maxCostPerHr);
      if (precio && tope > 0 && Number(precio) > tope) {
        const msg =
          `RunPod asigno un pod a $${Number(precio).toFixed(2)}/h, por encima del ` +
          `tope de $${tope.toFixed(2)}/h. Se devuelve sin usarlo.`;
        this.logger.warn(`[EmbedJob] ${msg}`);
        await this.prisma.embedJobRun.update({
          where: { id: run.id },
          data: { status: 'aborted', error: msg, finishedAt: new Date() },
        });
        await this.terminate(run.id, pod.id, 'deadline', msg);
        podId = null;
        return run.id;
      }

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
    // Anclado al arranque REAL de la ejecucion, no a este momento: si se
    // reanclara aqui, un pod adoptado tras cada redespliegue estrenaria plazo
    // cada vez y podria facturar indefinidamente. Lo mismo con el silencio
    // inicial de abajo.
    const arranque =
      (await this.prisma.embedJobRun.findUnique({ where: { id: runId } }))?.startedAt ?? new Date();
    const limite = arranque.getTime() + cfg.maxMinutes * 60_000;
    // Un pod sano escribe en el log a los pocos minutos (bootstrap, descarga del
    // modelo, primeros lotes). Si a los 25 no ha dicho NADA es que no consigue
    // hablar con la API, y esperar al plazo de 3 h son ~$4,80 tirados. Este limite
    // convierte ese fallo en ~$0,65.
    const mudoHasta = arranque.getTime() + 25 * 60_000;
    const inicial = (await this.prisma.embedJobRun.findUnique({ where: { id: runId } }))?.log?.length ?? 0;

    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const run = await this.prisma.embedJobRun.findUnique({ where: { id: runId } });
      if (!run) return;

      if (run.status === 'done' || run.status === 'failed') return;

      // Via 2b: el pod nunca dio senales de vida.
      if (Date.now() > mudoHasta && run.lotsDone === 0 && (run.log?.length ?? 0) <= inicial) {
        await this.abort(
          runId,
          'El pod no reporto nada en 25 min: probablemente no alcanza la API ' +
          '(revisa EMBED_CALLBACK_URL)',
          'deadline',
        );
        return;
      }

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

  // ─────────── El ciclo: embeber lo que falte y despues entrenar ───────────

  /**
   * Avanza el ciclo activo un paso por minuto.
   *
   * Es una maquina de estados y no una funcion larga con `await` porque el
   * ciclo dura horas: un pod de seis, a veces varios seguidos. Cualquier cosa
   * que lo mantuviera vivo en memoria —una promesa, un bucle— se lo lleva por
   * delante el primer redespliegue. Asi cada minuto se mira donde estaba,
   * escrito en la base, y se da el paso siguiente.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async rebuildTick(): Promise<void> {
    const ciclo = await this.prisma.modelRebuildRun.findFirst({
      where: { status: { in: ['queued', 'embedding', 'training'] } },
      orderBy: { startedAt: 'desc' },
    });
    if (!ciclo) return;

    try {
      if (ciclo.status === 'queued') await this.cicloArrancar(ciclo);
      else if (ciclo.status === 'embedding') await this.cicloEmbebiendo(ciclo);
      else if (ciclo.status === 'training') await this.cicloEntrenando(ciclo);
    } catch (e) {
      this.logger.error(`[Rebuild] ${ciclo.id}: ${(e as Error).message}`);
      await this.cicloLog(ciclo.id, `error: ${(e as Error).message}`);
    }
  }

  /** Cola → embebiendo, o directo a entrenar si no falta ningun vector. */
  private async cicloArrancar(ciclo: any): Promise<void> {
    const cfg = await this.config();
    const faltan = await this.countPendingRebuild(ciclo.windowDays, ciclo.pcaVersion);
    if (!faltan) {
      await this.cicloLog(ciclo.id, 'no falta ningun vector: se pasa directo a entrenar');
      await this.lanzarEntrenamiento(ciclo, cfg);
      return;
    }

    // Un ciclo reanudado ya tiene lotes hechos: si el objetivo fuera solo lo que
    // falta, la barra retrocederia al reanudar y diria 41.000 de 47.000.
    const tandas = await this.prisma.embedJobRun.findMany({ where: { rebuildId: ciclo.id } });
    const hechos = tandas.reduce((n, t) => n + t.lotsDone, 0);

    await this.prisma.modelRebuildRun.update({
      where: { id: ciclo.id },
      data: { status: 'embedding', lotsTarget: hechos + faltan, lotsDone: hechos },
    });
    await this.cicloLog(ciclo.id,
      hechos
        ? `reanudado: ${hechos} lotes hechos, ${faltan} por embeber`
        : `${faltan} lotes por embeber`);
    await this.nuevaTanda(ciclo.id);
  }

  /**
   * Embebiendo: espera a la tanda en curso y encadena la siguiente.
   *
   * Hacen falta varias porque un pod se corta por tiempo (`maxMinutes`) mucho
   * antes de vaciar la cola: 345 minutos son unos 36.000 lotes, y un ciclo
   * completo puede pedir el triple.
   */
  private async cicloEmbebiendo(ciclo: any): Promise<void> {
    const cfg = await this.config();
    const tandas = await this.prisma.embedJobRun.findMany({
      where: { rebuildId: ciclo.id },
      orderBy: { startedAt: 'desc' },
    });
    const viva = tandas.find((t) => ['pending', 'provisioning', 'running'].includes(t.status));

    const hechos = tandas.reduce((n, t) => n + t.lotsDone, 0);
    const gastado = tandas.reduce((n, t) => n + Number(t.costUsd ?? 0), 0);
    await this.prisma.modelRebuildRun.update({
      where: { id: ciclo.id },
      data: { lotsDone: hechos, costUsd: gastado, embedRuns: tandas.length },
    });
    if (viva) return; // la maquinaria de siempre la esta supervisando

    // ── Corta-circuitos del ciclo entero ──
    // `maxCostUsdPerRun` acota UNA tanda; sin este tope, un ciclo que encadena
    // tandas no tiene techo ninguno.
    if (gastado >= Number(cfg.maxCostUsdPerRebuild)) {
      await this.cerrarCiclo(ciclo.id, 'failed',
        `tope de gasto del ciclo alcanzado ($${gastado.toFixed(2)} de $${Number(cfg.maxCostUsdPerRebuild).toFixed(2)})`);
      return;
    }

    const faltan = await this.countPendingRebuild(ciclo.windowDays, ciclo.pcaVersion);
    if (!faltan) {
      await this.cicloLog(ciclo.id, `embebido completo: ${hechos} lotes en ${tandas.length} tandas, $${gastado.toFixed(2)}`);
      await this.lanzarEntrenamiento(ciclo, cfg);
      return;
    }

    // Una tanda que muere sin hacer un solo lote y se repite es un bucle de
    // pods ardiendo: si las dos ultimas acabaron en cero, se para.
    const ultimas = tandas.slice(0, 2);
    if (ultimas.length === 2 && ultimas.every((t) => t.lotsDone === 0 && t.status !== 'done')) {
      await this.cerrarCiclo(ciclo.id, 'failed',
        'dos tandas seguidas terminaron sin embeber ningun lote; se para para no encadenar pods');
      return;
    }

    await this.nuevaTanda(ciclo.id);
  }

  /** Deja la siguiente tanda en el buzon; `pickup` la arranca en menos de un minuto. */
  private async nuevaTanda(rebuildId: string): Promise<void> {
    const yaHay = await this.prisma.embedJobRun.findFirst({
      where: { status: { in: ['pending', 'provisioning', 'running'] } },
    });
    if (yaHay) return; // el job suelto tiene una en marcha: se espera turno
    await this.prisma.embedJobRun.create({
      data: { status: 'pending', rebuildId, log: '[cola] tanda de un ciclo de rebuild\n' },
    });
    await this.cicloLog(rebuildId, 'nueva tanda de pod encolada');
  }

  /**
   * Lanza el entrenamiento que cierra el ciclo.
   *
   * `force` va cuando la agrupacion cambio: el modelo que sirve fue entrenado
   * con vectores que significaban otra cosa, asi que compararlos no mide nada
   * —tienen los mismos nombres de columna y el mismo tamaño— y el campeon
   * perderia por razones que no son su calidad.
   */
  private async lanzarEntrenamiento(ciclo: any, cfg: any): Promise<void> {
    let pcaServido: string | null = null;
    try {
      const r = await fetch(`${ML_URL}/health`, { signal: AbortSignal.timeout(8000) });
      pcaServido = r.ok ? ((await r.json()).pca_version ?? null) : null;
    } catch { /* si no responde, el POST de abajo dara el error de verdad */ }

    const cambioAgrupacion = !!pcaServido && pcaServido !== ciclo.pcaVersion;
    if (cambioAgrupacion) {
      await this.cicloLog(ciclo.id,
        `el modelo que sirve usa ${pcaServido} y este ciclo produce ${ciclo.pcaVersion}: ` +
        'no son comparables, se promueve el nuevo a proposito');
    }

    const soloConImagenes = cfg.trainingOnlyWithImages;
    const run = await this.prisma.modelTrainingRun.create({
      data: {
        status: 'running',
        trainingDays: ciclo.windowDays,
        onlyWithImages: soloConImagenes,
      },
    });
    await this.prisma.modelRebuildRun.update({
      where: { id: ciclo.id },
      data: { status: 'training', trainingRunId: run.id },
    });

    try {
      const res = await fetch(`${ML_URL}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: ciclo.windowDays,
          autoPromote: cfg.autoPromote,
          onlyWithImages: soloConImagenes,
          force: cambioAgrupacion,
          pcaVersion: ciclo.pcaVersion,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? 'el servicio de modelo lo rechazo');
      await this.cicloLog(ciclo.id, 'entrenando');
    } catch (e) {
      await this.prisma.modelTrainingRun.update({
        where: { id: run.id },
        data: { status: 'failed', error: (e as Error).message, finishedAt: new Date() },
      });
      await this.cerrarCiclo(ciclo.id, 'failed', `no se pudo entrenar: ${(e as Error).message}`);
    }
  }

  /**
   * Entrenando: sondea el servicio y cierra las dos filas cuando termina.
   *
   * El cierre se hace aqui y no al abrir la pantalla porque si nadie la abre, la
   * fila se queda en `running` para siempre y el ciclo siguiente cree que hay
   * uno en curso.
   */
  private async cicloEntrenando(ciclo: any): Promise<void> {
    let vivo: any = null;
    try {
      const r = await fetch(`${ML_URL}/train/status`, { signal: AbortSignal.timeout(8000) });
      vivo = r.ok ? await r.json() : null;
    } catch { return; } // reiniciandose: se vuelve a mirar en un minuto
    if (!vivo || vivo.running || !vivo.result) return;

    const res = vivo.result;
    if (ciclo.trainingRunId) {
      await this.prisma.modelTrainingRun.update({
        where: { id: ciclo.trainingRunId },
        data: {
          status: res.cancelled ? 'cancelled' : res.error ? 'failed' : 'done',
          finishedAt: new Date(),
          error: res.error ?? null,
          rowsTrain: res.rowsTrain ?? null,
          rowsValid: res.rowsValid ?? null,
          rowsWithImages: res.rowsWithImages ?? null,
          maeChampion: res.maeChampion ?? null,
          maeChallenger: res.maeChallenger ?? null,
          maeBaseline: res.maeBaseline ?? null,
          intervalCoverage: res.intervalCoverage ?? null,
          promoted: !!res.promoted,
          promotedReason: res.promotedReason ?? null,
          modelVersion: res.modelVersion ?? null,
          log: (vivo.log ?? []).join('\n').slice(-40_000),
        },
      }).catch(() => undefined);
    }

    if (res.error && !res.cancelled) {
      await this.cerrarCiclo(ciclo.id, 'failed', `el entrenamiento fallo: ${res.error}`);
    } else if (res.cancelled) {
      await this.cerrarCiclo(ciclo.id, 'cancelled', 'entrenamiento cancelado');
    } else {
      await this.cerrarCiclo(ciclo.id, 'done',
        res.promoted
          ? `modelo ${res.modelVersion} promovido (MAE $${res.maeChallenger})`
          : `entrenado sin sustituir: ${res.promotedReason ?? 'no gano'}`);
    }
  }

  private async cerrarCiclo(id: string, status: string, motivo: string): Promise<void> {
    await this.cicloLog(id, motivo);
    await this.prisma.modelRebuildRun.update({
      where: { id },
      data: { status, finishedAt: new Date(), error: status === 'failed' ? motivo : null },
    }).catch(() => undefined);
    this.logger.log(`[Rebuild] ${id} ${status}: ${motivo}`);
  }

  private async cicloLog(id: string, linea: string): Promise<void> {
    const c = await this.prisma.modelRebuildRun.findUnique({ where: { id } });
    if (!c) return;
    await this.prisma.modelRebuildRun.update({
      where: { id },
      data: { log: `${c.log ?? ''}[${new Date().toISOString()}] ${linea}\n`.slice(-40_000) },
    }).catch(() => undefined);
  }

  /**
   * El ciclo automatico: cada N dias, a la hora fijada.
   *
   * Empieza apagado a proposito — encenderlo alquila GPUs — y no arranca nada
   * si ya hay un ciclo en curso.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoRebuildTick(): Promise<void> {
    const cfg = await this.config();
    if (!cfg.autoRebuildEnabled) return;

    const hora = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
      }).format(new Date()),
    );
    if (hora !== cfg.autoRebuildHour) return;

    const ultimo = cfg.lastAutoRebuildAt?.getTime() ?? 0;
    if (Date.now() - ultimo < cfg.autoRebuildEveryDays * 86_400_000) return;

    const enCurso = await this.prisma.modelRebuildRun.findFirst({
      where: { status: { in: ['queued', 'embedding', 'training'] } },
    });
    if (enCurso) {
      this.logger.warn('[Rebuild] toca el ciclo automatico pero ya hay uno en curso');
      return;
    }

    const meta = leerMetaPca(cfg.pooling);
    const ciclo = await this.prisma.modelRebuildRun.create({
      data: {
        status: 'queued', trigger: 'scheduled',
        windowDays: cfg.trainingDays,
        pooling: meta.pooling, pcaVersion: meta.pcaVersion,
        log: `[${new Date().toISOString()}] ciclo automatico (cada ${cfg.autoRebuildEveryDays} dias)\n`,
      },
    });
    await this.prisma.embedJobConfig.update({
      where: { id: CONFIG_ID }, data: { lastAutoRebuildAt: new Date() },
    });
    this.logger.log(`[Rebuild] ciclo automatico encolado (${ciclo.id})`);
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
