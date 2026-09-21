import {
  BadRequestException, Injectable, Logger, NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';

/** El formulario publico de TxDMV. No hay API oficial: esto es lo que hay. */
const TXDMV_URL = 'https://tools.txdmv.gov/tools/SPV/spv_lookup.php';

/**
 * Cuanto vale una consulta guardada.
 *
 * TxDMV recalcula los SPV una vez por semana, asi que pedir el mismo VIN dos
 * veces el mismo dia da el mismo numero. La cache no es solo velocidad: es lo
 * que evita convertir un servicio del estado en nuestro backend.
 */
const FRESCO_MS = 7 * 24 * 3_600_000;

const ESTADOS_SOPORTADOS = ['TX'];

export interface SpvResult {
  state: string;
  vin: string;
  odometer: number;
  year: number | null;
  make: string | null;
  model: string | null;
  /** Valor en dolares enteros. */
  value: number;
  currency: 'USD';
  source: string;
  fetchedAt: Date;
  /** true cuando salio de la cache y no se llamo a TxDMV. */
  cached: boolean;
}

/**
 * Standard Presumptive Value: lo que el condado usa para calcular el impuesto
 * de una venta entre particulares.
 *
 * ── Por que raspamos un formulario ──
 * TxDMV no publica ninguna API. El SPV vive en la calculadora publica y dentro
 * de RTS/webDEALER, que es un sistema cerrado para oficinas de condado. El
 * formulario es un POST plano sin captcha ni token, asi que es la unica via
 * programatica que existe — y por eso mismo puede cambiar sin avisar.
 *
 * El parser falla EN VOZ ALTA si la pagina cambia de forma. Es deliberado: un
 * parser que ante lo inesperado devuelve 0 o null mete un impuesto mal calculado
 * en un tramite de titulo, y nadie se entera hasta que lo rechaza el condado.
 */
@Injectable()
export class SpvService {
  private readonly logger = new Logger(SpvService.name);

  constructor(private readonly prisma: PrismaService) {}

  async lookup(entrada: { vin?: string; odometer?: unknown; state?: string }): Promise<SpvResult> {
    const state = (entrada.state ?? 'TX').trim().toUpperCase();
    const vin = (entrada.vin ?? '').trim().toUpperCase();
    const odometer = Number(entrada.odometer);

    if (!ESTADOS_SOPORTADOS.includes(state)) {
      throw new NotImplementedException(
        `De momento solo esta TX. Estado pedido: ${state}`,
      );
    }
    // Se valida aqui para no gastar una llamada al estado en algo que ya se sabe
    // que va a rebotar. TxDMV valida igualmente; esto es cortesia, no confianza.
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
      throw new BadRequestException(
        `VIN invalido: "${vin}". Son 17 caracteres y no llevan I, O ni Q.`,
      );
    }
    if (!Number.isInteger(odometer) || odometer < 0 || odometer > 999_999) {
      throw new BadRequestException(`Odometro invalido: "${entrada.odometer}"`);
    }

    const guardada = await this.prisma.spvQuote.findUnique({
      where: { state_vin_odometer: { state, vin, odometer } },
    });
    if (guardada && Date.now() - guardada.fetchedAt.getTime() < FRESCO_MS) {
      return { ...this.aResultado(guardada), cached: true };
    }

    const datos = this.parsear(await this.pedirATxdmv(vin, odometer));

    const fila = await this.prisma.spvQuote.upsert({
      where: { state_vin_odometer: { state, vin, odometer } },
      create: { state, vin, odometer, ...datos, source: 'txdmv' },
      update: { ...datos, source: 'txdmv', fetchedAt: new Date() },
    });
    return { ...this.aResultado(fila), cached: false };
  }

  private aResultado(f: {
    state: string; vin: string; odometer: number; year: number | null;
    make: string | null; model: string | null; value: number; source: string;
    fetchedAt: Date;
  }): SpvResult {
    return {
      state: f.state, vin: f.vin, odometer: f.odometer,
      year: f.year, make: f.make, model: f.model,
      value: f.value, currency: 'USD',
      source: f.source, fetchedAt: f.fetchedAt, cached: false,
    };
  }

  /** Un reintento: la caida tipica aqui es un hipo de red, no un rechazo. */
  private async pedirATxdmv(vin: string, odometer: number): Promise<string> {
    let ultimo: unknown = null;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const res = await fetch(TXDMV_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Identificarse es lo minimo al usar un servicio publico ajeno.
            'User-Agent': 'HtownAutos/1.0 (dealer tooling; contacto via htownautos.com)',
          },
          body: new URLSearchParams({ vin, mileage: String(odometer) }).toString(),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`TxDMV respondio ${res.status}`);
        return await res.text();
      } catch (err) {
        ultimo = err;
        this.logger.warn(`[SPV] intento ${intento + 1}/2 fallo: ${(err as Error).message}`);
      }
    }
    throw new ServiceUnavailableException(
      `No se pudo consultar TxDMV: ${(ultimo as Error)?.message ?? 'sin respuesta'}`,
    );
  }

  /**
   * De HTML a numeros.
   *
   * La pagina es una tabla de etiqueta y valor, asi que se aplana a lineas y se
   * lee el siguiente token despues de cada etiqueta. Es feo, pero sobrevive a
   * cambios de maquetado mientras las etiquetas sigan diciendo lo mismo — que es
   * mas de lo que aguantaria un selector CSS.
   */
  private parsear(html: string): {
    year: number | null; make: string | null; model: string | null; value: number;
  } {
    const lineas = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // TxDMV contesta los errores en la misma pagina: "Error: Invalid VIN "X"".
    const error = lineas.find((l) => /^Error:/i.test(l));
    if (error) throw new BadRequestException(error.replace(/^Error:\s*/i, 'TxDMV: '));

    const tras = (etiqueta: string): string | undefined => {
      const i = lineas.findIndex((l) => l.toLowerCase() === etiqueta.toLowerCase());
      return i >= 0 ? lineas[i + 1] : undefined;
    };

    // La calculadora lo rotula "Private Value"; se acepta tambien el nombre
    // largo por si vuelven a cambiarlo, como ya hicieron una vez.
    const crudo = tras('Private Value:') ?? tras('Standard Presumptive Value:');
    const value = crudo ? Number(crudo.replace(/[^0-9.]/g, '')) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      this.logger.error(`[SPV] no se encontro el valor; primeras lineas: ${lineas.slice(0, 12).join(' | ')}`);
      throw new ServiceUnavailableException(
        'La pagina de TxDMV no trae el valor donde se esperaba: el parser necesita revision',
      );
    }

    const anio = Number(tras('Year:'));
    return {
      year: Number.isFinite(anio) && anio > 1900 ? anio : null,
      make: tras('Make:') ?? null,
      model: tras('Model:') ?? null,
      value: Math.round(value),
    };
  }
}
