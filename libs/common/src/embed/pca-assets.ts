import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Donde viven los ficheros que el pod se descarga al arrancar.
 *
 * Son tres sitios porque el mismo codigo corre desde el repo en desarrollo y
 * desde el bundle compilado en produccion, y ninguno de los dos layouts es
 * negociable.
 */
export function rutaAsset(nombre: string): string | null {
  const candidatos = [
    join(process.cwd(), 'assets', 'embed-jobs', nombre),
    join(__dirname, 'assets', nombre),
    join(__dirname, '..', '..', '..', 'apps', 'api', 'src', 'embed-jobs', 'assets', nombre),
    join(process.cwd(), 'apps', 'api', 'src', 'embed-jobs', 'assets', nombre),
  ];
  return candidatos.find((p) => existsSync(p)) ?? null;
}

export interface MetaPca {
  pcaVersion: string;
  pooling: string;
  slots: number;
  dims: number;
}

/** El PCA que le toca a cada agrupacion. */
export function ficheroPca(pooling: string): string {
  return pooling === 'slots' ? 'pca_img_slots.npz' : 'pca_img_mean.npz';
}

/**
 * La etiqueta que llevaran los vectores calculados con este PCA.
 *
 * Vive en un JSON al lado del `.npz` y no en una constante de codigo: la
 * etiqueta tiene que viajar con los datos. Si se cambia el PCA y aqui siguiera
 * escrito "mean-64d", el ciclo daria por buenos vectores que ya significan otra
 * cosa — mismas 64 dimensiones, otro espacio — y no habria ningun error que lo
 * delatara, solo predicciones peores.
 */
export function leerMetaPca(pooling: string): MetaPca {
  const nombre = ficheroPca(pooling).replace(/\.npz$/, '.json');
  const ruta = rutaAsset(nombre);
  if (ruta) {
    try {
      const m = JSON.parse(readFileSync(ruta, 'utf8')) as Partial<MetaPca>;
      if (m.pcaVersion) {
        return {
          pcaVersion: m.pcaVersion,
          pooling: m.pooling ?? pooling,
          slots: m.slots ?? 0,
          dims: m.dims ?? 64,
        };
      }
    } catch {
      /* cae al valor de respaldo */
    }
  }
  // Respaldo: el PCA original, con el que se calcularon los vectores que ya
  // existen. Nunca inventar una etiqueta nueva aqui — marcaria como validos
  // vectores que no lo son.
  return { pcaVersion: 'mean-64d', pooling: 'mean', slots: 0, dims: 64 };
}
