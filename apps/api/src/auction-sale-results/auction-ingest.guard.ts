import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '@htownautos/prisma';
import { hasScope } from '@htownautos/auth';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Permiso que debe llevar la clave para poder mandar datos de subasta. */
export const AUCTION_INGEST_SCOPE = 'auction-ingest:write';

/**
 * Autoriza a las VM scraper: ingesta de frames en vivo, resultados de venta y
 * el reparto de subastas.
 *
 * Acepta dos cosas, en este orden:
 *
 *  1. Una **API key gestionada** (Settings → Integrations) con el permiso
 *     `auction-ingest:write`. Es la buena: se revoca una sola maquina sin tocar
 *     las demas, se ve cuando se uso por ultima vez y desde que IP, y caduca.
 *
 *  2. `AUCTION_INGEST_API_KEY`, la clave de entorno de siempre. **Obsoleta** y
 *     solo por compatibilidad: la comparten todas las VM, no se puede revocar
 *     una sola, y estas rutas devuelven credenciales de cuentas de subasta.
 *
 * El camino viejo sigue abierto a proposito. Hay VMs en produccion capturando
 * ahora mismo y un corte seco las dejaria a todas fuera a la vez. Cada uso
 * escribe un aviso en el log; cuando dejen de aparecer, se borra esa rama.
 */
@Injectable()
export class AuctionIngestGuard implements CanActivate {
  private readonly logger = new Logger(AuctionIngestGuard.name);
  /** Para no llenar el log: un aviso por prefijo cada diez minutos. */
  private lastWarnAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const provided = this.extract(req);
    if (!provided) {
      throw new UnauthorizedException('Missing API key (X-API-Key, Bearer, or ?token=)');
    }

    if (await this.checkManagedKey(req, provided)) return true;
    if (this.checkLegacyEnvKey(req)) return true;

    throw new UnauthorizedException('Invalid API key');
  }

  /** Clave creada en Settings → Integrations. */
  private async checkManagedKey(req: any, raw: string): Promise<boolean> {
    const hashedKey = createHash('sha256').update(raw).digest('hex');
    const key = await this.prisma.apiKey.findUnique({ where: { hashedKey } });
    if (!key) return false;

    if (key.revokedAt) throw new UnauthorizedException('API key revoked');
    if (key.expiresAt && key.expiresAt < new Date()) {
      throw new UnauthorizedException('API key expired');
    }
    if (!hasScope(key.scopes, AUCTION_INGEST_SCOPE)) {
      throw new UnauthorizedException(`API key is missing the ${AUCTION_INGEST_SCOPE} scope`);
    }

    // Deja rastro de quien mando que, que es justo lo que la clave compartida
    // no permitia. Sin await: no merece retrasar la ingesta.
    this.prisma.apiKey
      .update({
        where: { id: key.id },
        data: { lastUsedAt: new Date(), lastUsedIp: this.ip(req) },
      })
      .catch(() => undefined);

    req.apiKey = { id: key.id, name: key.name, prefix: key.prefix };
    return true;
  }

  /** La clave de entorno de siempre. Obsoleta. */
  private checkLegacyEnvKey(req: any): boolean {
    const expected = process.env.AUCTION_INGEST_API_KEY;
    if (!expected) return false;
    const provided = this.extract(req);
    if (!provided || !this.constantTimeEqual(provided, expected)) return false;

    if (Date.now() - this.lastWarnAt > 600_000) {
      this.lastWarnAt = Date.now();
      this.logger.warn(
        `[Ingest] Clave de entorno obsoleta usada desde ${this.ip(req)}. ` +
          'Crea una API key en Settings → Integrations con el permiso ' +
          `${AUCTION_INGEST_SCOPE} y cambiala en esa VM.`,
      );
    }
    req.apiKey = { id: 'legacy-env', name: 'AUCTION_INGEST_API_KEY (deprecated)', prefix: 'env' };
    return true;
  }

  private ip(req: any): string {
    return (
      (req.headers?.['cf-connecting-ip'] as string) ||
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      'unknown'
    );
  }

  private extract(req: any): string | null {
    const header = req.headers?.['x-api-key'];
    if (typeof header === 'string' && header.length) return header;

    const auth: string | undefined = req.headers?.authorization;
    if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();

    const token = req.query?.token;
    if (typeof token === 'string' && token.length) return token;

    return null;
  }

  private constantTimeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a, 'utf8');
    const bBuf = Buffer.from(b, 'utf8');
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }
}
