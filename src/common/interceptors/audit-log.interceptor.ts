import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AUDIT_LOG_KEY, AuditLogMetadata } from '../decorators/audit-log.decorator';
import { PrismaService } from '../../prisma.service';

/**
 * Interceptor para auditoría de operaciones
 * Cumple con requisitos de RouteOne, DealerTrack, GLBA y OFAC
 *
 * Registra:
 * - Quién accedió (usuario/IP)
 * - Qué recurso (buyer, deal, vehicle)
 * - Cuándo (timestamp)
 * - Qué acción (create, read, update, delete)
 * - Resultado (success/failure)
 * - Datos sensibles accedidos (PII)
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metadata = this.reflector.get<AuditLogMetadata>(
      AUDIT_LOG_KEY,
      context.getHandler(),
    );

    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const { method, url, ip, headers } = request;
    const userAgent = headers['user-agent'] || 'unknown';
    const tenantId = headers['x-tenant-id'] || null;
    const startTime = Date.now();

    // Extract user info from JWT token
    const { cognitoSub, tokenEmail } = this.extractUserFromToken(request);

    // Extraer IDs de recursos desde params/body
    const resourceId = request.params?.id || request.body?.id || null;
    const buyerId = request.params?.buyerId || request.body?.buyerId || request.query?.buyerId;
    const vehicleId = request.params?.vehicleId || request.body?.vehicleId || request.query?.vehicleId;
    const dealId = request.params?.dealId || request.body?.dealId || request.query?.dealId;

    return next.handle().pipe(
      tap(async () => {
        const duration = Date.now() - startTime;

        // After handler, request.user should be populated by the guard
        const userId = request.user?.id || cognitoSub || 'anonymous';
        const userEmail = request.user?.email || tokenEmail || 'unknown';

        this.logger.log(
          `[AUDIT] ${metadata.action.toUpperCase()} ${metadata.resource} - User: ${userEmail} (${userId}) - IP: ${ip}`,
        );

        // Crear registro de auditoría
        await this.createAuditLog({
          userId,
          userEmail,
          cognitoSub,
          tenantId,
          action: metadata.action,
          resource: metadata.resource,
          resourceId,
          buyerId,
          vehicleId,
          dealId,
          method,
          url,
          ipAddress: ip,
          userAgent,
          status: 'success',
          duration,
          level: metadata.level,
          pii: metadata.pii,
          compliance: metadata.compliance || [],
          metadata: {
            params: request.params,
            query: request.query,
            // No registrar body completo por seguridad, solo IDs
            bodyKeys: request.body ? Object.keys(request.body) : [],
          },
        });
      }),
      catchError(async (error) => {
        const duration = Date.now() - startTime;

        // After handler, request.user might be populated by the guard
        const userId = request.user?.id || cognitoSub || 'anonymous';
        const userEmail = request.user?.email || tokenEmail || 'unknown';

        this.logger.log(
          `[AUDIT] ${metadata.action.toUpperCase()} ${metadata.resource} - User: ${userEmail} (${userId}) - IP: ${ip} - FAILED`,
        );

        // Registrar errores también (importante para compliance)
        await this.createAuditLog({
          userId,
          userEmail,
          cognitoSub,
          tenantId,
          action: metadata.action,
          resource: metadata.resource,
          resourceId,
          buyerId,
          vehicleId,
          dealId,
          method,
          url,
          ipAddress: ip,
          userAgent,
          status: 'failure',
          duration,
          level: metadata.level,
          pii: metadata.pii,
          compliance: metadata.compliance || [],
          errorMessage: error.message,
          errorCode: error.status || 500,
          metadata: {
            params: request.params,
            query: request.query,
            bodyKeys: request.body ? Object.keys(request.body) : [],
          },
        });

        throw error;
      }),
    );
  }

  /**
   * Extract user info from tokens
   * - sub comes from access token (Authorization header)
   * - email comes from id token (X-Id-Token header)
   */
  private extractUserFromToken(request: any): { cognitoSub: string | null; tokenEmail: string | null } {
    let cognitoSub: string | null = null;
    let tokenEmail: string | null = null;

    try {
      // Get sub from access token (Authorization header)
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const accessToken = authHeader.substring(7);
        const accessPayload = this.decodeJwtPayload(accessToken);
        if (accessPayload) {
          cognitoSub = accessPayload.sub || null;
        }
      }

      // Get email from id token (X-Id-Token header)
      const idToken = request.headers['x-id-token'];
      if (idToken) {
        const idPayload = this.decodeJwtPayload(idToken);
        if (idPayload) {
          tokenEmail = idPayload.email || null;
        }
      }

      return { cognitoSub, tokenEmail };
    } catch {
      return { cognitoSub: null, tokenEmail: null };
    }
  }

  /**
   * Decode JWT payload without verification
   */
  private decodeJwtPayload(token: string): any | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }
      return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  private async createAuditLog(data: any) {
    try {
      // Crear log en la base de datos
      await this.prisma.getModel('auditLog').create({
        data: {
          userId: data.userId,
          userEmail: data.userEmail,
          tenantId: data.tenantId,
          action: data.action,
          resource: data.resource,
          resourceId: data.resourceId,
          buyerId: data.buyerId,
          vehicleId: data.vehicleId,
          dealId: data.dealId,
          method: data.method,
          url: data.url,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          status: data.status,
          duration: data.duration,
          level: data.level,
          pii: data.pii,
          compliance: data.compliance,
          errorMessage: data.errorMessage,
          errorCode: data.errorCode,
          metadata: data.metadata,
        },
      });

      // Log crítico a consola para sistemas externos (Splunk, ELK, etc.)
      if (data.level === 'critical' || data.pii) {
        this.logger.warn(
          `[CRITICAL-AUDIT] ${data.action.toUpperCase()} ${data.resource} - ` +
          `User: ${data.userEmail} (${data.cognitoSub}) - Resource: ${data.resourceId} - ` +
          `Status: ${data.status} - PII: ${data.pii} - ` +
          `Compliance: ${data.compliance.join(', ')}`,
        );
      }
    } catch (error) {
      // NUNCA fallar la operación por error de auditoría
      // Pero loggear el error para investigación
      this.logger.error(
        `Failed to create audit log: ${error.message}`,
        error.stack,
      );
    }
  }
}
