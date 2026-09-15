import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';

/** Lo que devuelve el servicio de modelo. */
export interface PricePrediction {
  lot: string;
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
    };

    const res = await this.call(payload);
    const health = await this.health();

    return {
      lot,
      esperado: res.esperado,
      p10: res.p10,
      p90: res.p90,
      incertidumbre: res.incertidumbre ?? null,
      modelVersion: res.modelVersion ?? 'desconocida',
      entrenadoCon: health?.entrenado_con ?? 0,
      faltan: this.missing(payload),
    };
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
