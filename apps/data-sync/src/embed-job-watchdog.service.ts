import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@htownautos/prisma';
import { RunpodService } from '@htownautos/common';
// El tope duro vive en el servicio que crea el pod: quien lo arranca tiene que
// saber cuanto se le va a dejar vivir, o planifica trabajo que no le cabe.
import { EmbedJobService, POD_PREFIX, TOPE_DURO_MIN } from './embed-job.service';

/** Margen sobre `maxMinutes` antes de que el vigilante considere colgado un pod. */
const MARGEN_MIN = 15;

/**
 * Silencio tras el cual un pod se da por muerto aunque siga encendido.
 *
 * El pod habla constantemente: el bootstrap manda log cada 10 s y cada trozo
 * escribe vectores, asi que veinticinco minutos callado significa que el worker
 * murio. Sin esta comprobacion el unico corte era el limite de 360 min: un pod
 * que pierde la red a los cien minutos —un mantenimiento del host, sin ir mas
 * lejos— seguia facturando cuatro horas sin hacer nada, porque su ejecucion se
 * quedaba en `running` y nadie la cerraba.
 */
const SILENCIO_MAX_MIN = 25;

/**
 * Vigilante de pods huerfanos.
 *
 * Existe porque las otras vias de apagado comparten un punto debil: todas viven
 * dentro del proceso que lanzo el job. Si ese proceso muere —OOM, redespliegue,
 * el host reiniciando— el pod se queda encendido facturando y nadie se entera.
 *
 * Este vigilante no sabe nada del job: pregunta a RunPod que pods existen y borra
 * los que no deberian seguir vivos. Funciona aunque la ejecucion que los creo
 * haya desaparecido del todo.
 *
 * SOLO toca pods cuyo nombre empieza por `htownautos-embed`. Es la unica
 * salvaguarda que impide que un fallo aqui borre otra cosa de la cuenta, asi que
 * el filtro va antes que cualquier otra comprobacion.
 */
@Injectable()
export class EmbedJobWatchdogService {
  private readonly logger = new Logger(EmbedJobWatchdogService.name);
  private corriendo = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runpod: RunpodService,
    private readonly job: EmbedJobService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async tick(): Promise<void> {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      await this.barrer();
    } catch (err: any) {
      this.logger.error(`[Watchdog] ${err.message}`);
    } finally {
      this.corriendo = false;
    }
  }

  async barrer(): Promise<{ revisados: number; borrados: number }> {
    if (!(process.env.RUNPOD_API_KEY || process.env.RUNPOD)) {
      return { revisados: 0, borrados: 0 };
    }

    const todos = await this.runpod.listPods();
    const mios = todos.filter((p) => (p.name ?? '').startsWith(POD_PREFIX));
    if (!mios.length) return { revisados: 0, borrados: 0 };

    const cfg = await this.job.config();
    const limiteMin = Math.min(cfg.maxMinutes + MARGEN_MIN, TOPE_DURO_MIN);
    let borrados = 0;

    for (const pod of mios) {
      const motivo = await this.porQueBorrar(pod, limiteMin);
      if (!motivo) continue;

      this.logger.warn(`[Watchdog] borrando ${pod.id} (${pod.name}): ${motivo}`);
      const run = await this.prisma.embedJobRun.findFirst({ where: { podId: pod.id } });
      if (run) {
        await this.job.terminate(run.id, pod.id, 'watchdog', motivo);
      } else {
        // Sin fila asociada no hay donde apuntar nada: se borra y se registra
        // en el log del servicio, que es lo unico que queda.
        await this.runpod.deletePod(pod.id);
      }
      borrados++;
    }

    if (borrados) {
      this.logger.warn(`[Watchdog] ${borrados} pod(s) huerfanos borrados de ${mios.length}`);
    }
    return { revisados: mios.length, borrados };
  }

  /** Devuelve el motivo por el que un pod debe morir, o null si puede seguir. */
  private async porQueBorrar(
    pod: { id: string; lastStartedAt?: string },
    limiteMin: number,
  ): Promise<string | null> {
    const run = await this.prisma.embedJobRun.findFirst({ where: { podId: pod.id } });

    if (!run) return 'no hay ninguna ejecucion asociada a este pod';

    if (['done', 'failed', 'aborted'].includes(run.status)) {
      return `la ejecucion termino como "${run.status}" pero el pod sigue vivo`;
    }

    const arranque = pod.lastStartedAt ? new Date(pod.lastStartedAt).getTime() : run.startedAt.getTime();
    const minutos = (Date.now() - arranque) / 60_000;
    if (minutos > limiteMin) {
      return `lleva ${Math.round(minutos)} min encendido (limite ${limiteMin})`;
    }

    // Encendido pero mudo. Se mide desde el arranque cuando todavia no ha dado
    // ninguna señal: bajar el modelo son unos minutos, y por eso el umbral es
    // holgado.
    const ultimaSeñal = (run.lastSeenAt ?? run.startedAt).getTime();
    const callado = (Date.now() - ultimaSeñal) / 60_000;
    if (callado > SILENCIO_MAX_MIN) {
      return `lleva ${Math.round(callado)} min sin dar señal (limite ${SILENCIO_MAX_MIN})`;
    }

    return null;
  }
}
