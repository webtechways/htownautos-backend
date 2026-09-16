import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';

/** Lo que devuelve el servicio de modelo. */
export interface PricePrediction {
  lot: string;
  /**
   * false cuando el lote no tiene vector de imagen y por tanto no se predice.
   * El modelo PODRIA responder sin fotos —LightGBM trata los huecos de forma
   * nativa— pero ese numero es medidamente peor ($1.241 frente a $1.142 de MAE
   * sobre los coches con foto) y se presentaria con la misma confianza que uno
   * bueno. Se prefiere no dar numero a dar uno que invita a confiar de mas.
   */
  disponible: boolean;
  /** Por que no hay prediccion, cuando `disponible` es false. */
  motivo?: string;
  /** Precio de martillo esperado, en dolares. */
  esperado: number;
  /** Extremos del intervalo calibrado al 80% de cobertura real. */
  p10: number;
  p90: number;
  /** Ancho del intervalo relativo al precio. Alto = no te la juegues aqui. */
  incertidumbre: number | null;
  modelVersion: string;
  /** Cuantas ventas parecidas respaldan esto, y desde cuando. */
  entrenadoCon: number;
  /** Campos que el modelo no recibio porque el listing no los trae. */
  faltan: string[];
  /** Si el modelo pudo mirar las fotos del lote o predijo solo con los datos. */
  conImagenes: boolean;
}

const ML_URL = process.env.ML_SERVICE_URL ?? 'http://htownautos-ml:8000';
const TIMEOUT_MS = 8000;

/**
 * Precio de martillo esperado para un lote que todavia no se ha rematado.
 *
 * El modelo vive en un contenedor aparte (`htownautos-ml`) y no toca la base de
 * datos: este servicio lee el listing, lo traduce al contrato del modelo y le
 * pasa los campos. Asi el contenedor de ML no necesita credenciales de Postgres.
 *
 * Ojo con lo que NO se le manda: `highBid` y `buyItNowPrice` del momento son la
 * puja en curso, y el modelo se entreno sin ellas a proposito — son fuga de datos
 * para una prediccion previa al remate. Mandarlas daria un numero que solo sabe
 * repetir la puja actual.
 */
@Injectable()
export class PricePredictionService {
  private readonly logger = new Logger(PricePredictionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async predict(lot: string): Promise<PricePrediction> {
    let lotNumber: bigint;
    try {
      lotNumber = BigInt(lot);
    } catch {
      throw new NotFoundException(`Lote invalido: ${lot}`);
    }

    const listing = await this.prisma.auctionListing.findUnique({
      where: { lotNumber },
    });
    if (!listing) throw new NotFoundException(`Lote ${lot} no encontrado`);

    // Pujas previas al remate: cuantos compradores DISTINTOS han pre-pujado. Se
    // cuentan compradores y no eventos porque un mismo cliente dispara decenas de
    // PREBID seguidas — el conteo de eventos mide ruido, no demanda.
    const prebids = await this.prisma.auctionBidEvent.findMany({
      where: { lot: lotNumber, eventType: 'PREBID' },
      select: { buyerNo: true },
      distinct: ['buyerNo'],
    });

    const imageCount = this.countImages(listing.galleryCache);

    // El vector de las fotos, si el job nocturno ya lo calculo. Se lee aqui y no
    // en el contenedor de ML para que ese siga sin credenciales de Postgres.
    // Si no existe, la prediccion sale igual: LightGBM trata los huecos de forma
    // nativa y el lote recibe respuesta sin fotos, algo peor y ya esta.
    const fila = await this.prisma.lotImageVector.findUnique({
      where: { lotNumber },
      select: { vector: true, dims: true },
    });
    const imageVector = fila ? this.unpack(fila.vector, fila.dims) : null;

    // Sin vector no se predice. Se distinguen los dos casos porque la accion del
    // usuario es distinta: "todavia no procesado" se resuelve solo esta noche;
    // "sin fotos en B2" no se resuelve nunca y no tiene sentido esperar.
    if (!imageVector) {
      const marcado = fila && fila.dims === 0;
      return {
        lot,
        disponible: false,
        motivo: marcado
          ? 'Este lote no tiene fotos disponibles en el almacenamiento, asi que no se puede valorar con imagenes.'
          : imageCount > 0
            ? 'Las fotos de este lote aun no se han procesado. El proceso nocturno las convierte y manana habra prediccion.'
            : 'Este lote no tiene fotos cacheadas todavia.',
        esperado: 0, p10: 0, p90: 0, incertidumbre: null,
        modelVersion: 'n/a', entrenadoCon: 0, faltan: [], conImagenes: false,
      };
    }
    const num = (v: unknown): number | null =>
      v === null || v === undefined ? null : Number(v);

    const payload = {
      lot,
      year: listing.year ?? null,
      make: listing.make ?? null,
      model: listing.modelGroup ?? null,
      modelDetail: listing.modelDetail ?? null,
      trim: listing.trim ?? null,
      bodyStyle: listing.bodyStyle ?? null,
      color: listing.color ?? null,
      damageDescription: listing.damageDescription ?? null,
      secondaryDamage: listing.secondaryDamage ?? null,
      saleTitleType: listing.saleTitleType ?? null,
      saleTitleState: listing.saleTitleState ?? null,
      odometer: num(listing.odometer),
      runsDrives: listing.runsDrives ?? null,
      engine: listing.engine ?? null,
      engineSizeL: num(listing.engineSizeL),
      transmission: listing.transmission ?? null,
      drive: listing.drive ?? null,
      fuelType: listing.fuelType ?? null,
      cylinders: listing.cylinders ?? null,
      estRetailValue: num(listing.estRetailValue),
      repairCost: num(listing.repairCost),
      yardName: listing.yardName ?? null,
      yardNumber: listing.yardNumber ?? null,
      locationState: listing.locationState ?? null,
      locationZip: listing.locationZip ?? null,
      locationLat: num(listing.locationLat),
      locationLng: num(listing.locationLng),
      sellerName: listing.sellerName ?? null,
      sellerCategory: listing.sellerCategory ?? null,
      autoGrade: listing.autoGrade ?? null,
      hasKeys: listing.hasKeys ?? null,
      saleLight: listing.saleLight ?? null,
      lotCondCode: listing.lotCondCode ?? null,
      odometerBrand: listing.odometerBrand ?? null,
      vehicleType: listing.vehicleType ?? null,
      imageCount,
      prebidBidders: prebids.length,
      ...(imageVector ? { imageVector } : {}),
    };

    const res = await this.call(payload);
    const health = await this.health();

    return {
      lot,
      disponible: true,
      esperado: res.esperado,
      p10: res.p10,
      p90: res.p90,
      incertidumbre: res.incertidumbre ?? null,
      modelVersion: res.modelVersion ?? 'desconocida',
      entrenadoCon: health?.entrenado_con ?? 0,
      faltan: this.missing(payload),
      conImagenes: res.conImagenes === true,
    };
  }

  /**
   * Que lotes ha "visto" el modelo, para una pagina de resultados.
   *
   * Tres estados y no dos, porque lo que puede hacer el usuario es distinto en
   * cada uno: `visto` tiene vector y se predice; `pendiente` lo tendra esta
   * noche; `sin-fotos` no lo tendra nunca y no sirve esperar.
   */
  async vectorStatus(lots: string[]): Promise<Record<string, 'visto' | 'pendiente' | 'sin-fotos'>> {
    const ids = lots
      .map((l) => { try { return BigInt(l); } catch { return null; } })
      .filter((v): v is bigint => v !== null)
      .slice(0, 500);
    if (!ids.length) return {};

    const filas = await this.prisma.lotImageVector.findMany({
      where: { lotNumber: { in: ids } },
      select: { lotNumber: true, dims: true },
    });

    const mapa: Record<string, 'visto' | 'pendiente' | 'sin-fotos'> = {};
    for (const id of ids) mapa[id.toString()] = 'pendiente';
    // dims 0 es una lapida: se intento y las fotos no estaban en B2.
    for (const f of filas) {
      mapa[f.lotNumber.toString()] = f.dims > 0 ? 'visto' : 'sin-fotos';
    }
    return mapa;
  }

  /**
   * Los vectores se guardan como float32 empaquetados (64 dims = 256 bytes) para
   * no inflar la tabla. Prisma los devuelve como Uint8Array, no Buffer.
   *
   * Si el tamano no cuadra con `dims` se devuelve null en vez de interpretar los
   * bytes a medias: un vector mal leido no da error, da un precio equivocado.
   */
  private unpack(buf: Uint8Array, dims: number): number[] | null {
    // dims 0 es una lapida: el lote se intento y sus fotos no estan en B2. No es
    // un vector vacio, es la ausencia de vector.
    if (!dims || !buf || buf.byteLength !== dims * 4) return null;
    const copia = new Uint8Array(buf); // asegura alineacion para Float32Array
    return Array.from(new Float32Array(copia.buffer));
  }

  /** `galleryCache` guarda el JSON de la galeria ya resuelto al CDN. */
  private countImages(cache: string | null): number {
    if (!cache) return 0;
    try {
      return Number(JSON.parse(cache)?.imageCount ?? 0);
    } catch {
      return 0;
    }
  }

  /**
   * Campos ausentes que mas pesan en el modelo. Se devuelven para que la UI
   * pueda avisar: una prediccion sin `modelDetail` ni `zip` —las dos features de
   * mas ganancia— es bastante menos fiable, y el usuario merece saberlo.
   */
  private missing(p: Record<string, unknown>): string[] {
    const importantes = [
      'modelDetail', 'locationZip', 'trim', 'yardName',
      'saleTitleState', 'year', 'odometer',
    ];
    return importantes.filter((k) => p[k] === null || p[k] === undefined);
  }

  private async call(payload: unknown): Promise<any> {
    try {
      const res = await fetch(`${ML_URL}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new HttpException(
          `El modelo respondio ${res.status}`,
          res.status === 422 ? 400 : 502,
        );
      }
      return await res.json();
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      this.logger.error(`[PricePrediction] ${ML_URL} fallo: ${err.message}`);
      throw new HttpException(
        'El servicio de prediccion no responde',
        503,
      );
    }
  }

  /** Metadatos del modelo. Si falla no se aborta: es informacion de adorno. */
  private async health(): Promise<any | null> {
    try {
      const res = await fetch(`${ML_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }
}
