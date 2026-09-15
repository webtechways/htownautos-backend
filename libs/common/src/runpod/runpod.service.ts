import { Injectable, Logger } from '@nestjs/common';

const BASE = 'https://rest.runpod.io/v1';
const TIMEOUT_MS = 30_000;

export interface RunpodPod {
  id: string;
  name?: string;
  desiredStatus?: string;
  costPerHr?: number | string;
  machine?: { gpuDisplayName?: string };
  gpu?: { displayName?: string; count?: number };
  lastStartedAt?: string;
  image?: string;
  portMappings?: Record<string, number> | null;
  publicIp?: string | null;
}

export interface CreatePodInput {
  name: string;
  imageName: string;
  gpuTypeIds: string[];
  env?: Record<string, string>;
  containerDiskInGb?: number;
  volumeInGb?: number;
  dockerStartCmd?: string[];
  minVCPUPerGPU?: number;
}

/**
 * Cliente de la API de RunPod.
 *
 * Una distincion que cuesta dinero si se confunde: `POST /pods/{id}/stop` PARA el
 * pod pero el volumen sigue facturando; `DELETE /pods/{id}` es lo unico que corta
 * el cobro del todo. Aqui solo se expone `deletePod`, a proposito — este sistema
 * alquila GPUs por una hora y no hay ningun caso en el que queramos dejar algo
 * parado y cobrando.
 */
@Injectable()
export class RunpodService {
  private readonly logger = new Logger(RunpodService.name);

  private key(): string {
    const k = process.env.RUNPOD_API_KEY ?? process.env.RUNPOD ?? '';
    if (!k) throw new Error('Falta RUNPOD (o RUNPOD_API_KEY) en el entorno');
    return k;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.key()}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`RunPod ${init.method ?? 'GET'} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    return text ? (JSON.parse(text) as T) : null;
  }

  async createPod(input: CreatePodInput): Promise<RunpodPod> {
    const pod = await this.call<RunpodPod>('/pods', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        imageName: input.imageName,
        gpuTypeIds: input.gpuTypeIds,
        gpuTypePriority: 'availability',
        gpuCount: 1,
        containerDiskInGb: input.containerDiskInGb ?? 60,
        volumeInGb: input.volumeInGb ?? 0,
        minVCPUPerGPU: input.minVCPUPerGPU ?? 8,
        ports: ['22/tcp'],
        env: input.env ?? {},
        ...(input.dockerStartCmd ? { dockerStartCmd: input.dockerStartCmd } : {}),
      }),
    });
    if (!pod?.id) throw new Error('RunPod creo el pod pero no devolvio id');
    return pod;
  }

  async getPod(id: string): Promise<RunpodPod | null> {
    try {
      return await this.call<RunpodPod>(`/pods/${id}`);
    } catch (err: any) {
      if (String(err.message).includes('404')) return null;
      throw err;
    }
  }

  async listPods(): Promise<RunpodPod[]> {
    const res = await this.call<RunpodPod[] | { pods?: RunpodPod[] }>('/pods');
    if (Array.isArray(res)) return res;
    return res?.pods ?? [];
  }

  /**
   * Borra el pod. Idempotente a proposito: un 404 se considera exito, porque el
   * unico resultado que importa es "ya no existe y no factura". Todas las vias de
   * apagado llaman aqui y ninguna debe fallar por llegar la segunda.
   */
  async deletePod(id: string): Promise<boolean> {
    try {
      await this.call(`/pods/${id}`, { method: 'DELETE' });
      this.logger.log(`[RunPod] pod ${id} borrado`);
      return true;
    } catch (err: any) {
      if (String(err.message).includes('404')) {
        this.logger.log(`[RunPod] pod ${id} ya no existia`);
        return true;
      }
      this.logger.error(`[RunPod] no se pudo borrar ${id}: ${err.message}`);
      return false;
    }
  }
}
