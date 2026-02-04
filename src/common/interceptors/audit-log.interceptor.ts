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
// Map resource names to Prisma model names
const RESOURCE_MODEL_MAP: Record<string, string> = {
  'vehicle': 'vehicle',
  'buyer': 'buyer',
  'deal': 'deal',
  'extra-expense': 'extraExpense',
  'media': 'media',
  'meta': 'meta',
  'title': 'title',
};

// Map nomenclator/reference ID fields to their Prisma model and display field
const NOMENCLATOR_FIELD_MAP: Record<string, { model: string; displayField: string }> = {
  vehicleTypeId:      { model: 'vehicleType',      displayField: 'title' },
  bodyTypeId:         { model: 'bodyType',          displayField: 'title' },
  fuelTypeId:         { model: 'fuelType',          displayField: 'title' },
  driveTypeId:        { model: 'driveType',         displayField: 'title' },
  transmissionTypeId: { model: 'transmissionType',  displayField: 'title' },
  vehicleConditionId: { model: 'vehicleCondition',  displayField: 'title' },
  vehicleStatusId:    { model: 'vehicleStatus',     displayField: 'title' },
  sourceId:           { model: 'vehicleSource',     displayField: 'title' },
  titleBrandId:       { model: 'titleBrand',        displayField: 'title' },
  mileageUnitId:      { model: 'mileageUnit',       displayField: 'title' },
  yearId:             { model: 'vehicleYear',       displayField: 'year' },
  makeId:             { model: 'vehicleMake',       displayField: 'name' },
  modelId:            { model: 'vehicleModel',      displayField: 'name' },
  trimId:             { model: 'vehicleTrim',       displayField: 'name' },
  titleStatusId:      { model: 'titleStatus',       displayField: 'title' },
  brandStatusId:      { model: 'brandStatus',       displayField: 'title' },
};

// Whitelist of fields to include in create/delete summaries per resource
const SUMMARY_FIELDS: Record<string, string[]> = {
  'vehicle': [
    'vin', 'stockNumber', 'status', 'color', 'mileage',
    'vehicleCost', 'askingPrice', 'msrp', 'wholesalePrice',
    'costPrice', 'listPrice', 'salePrice',
  ],
  'extra-expense': ['description', 'price', 'receipts', 'receiptIds'],
  'media': ['filename', 'mimeType', 'mediaType', 'category', 'url'],
  'meta': ['key', 'value'],
  'title': [
    'titleNumber', 'titleState', 'titleAppNumber',
  ],
};

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) { }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
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

    // Use resource type to map params.id to the correct entity ID field
    const resourceLower = metadata.resource.toLowerCase();
    const buyerId = request.params?.buyerId || request.body?.buyerId || request.query?.buyerId
      || (resourceLower === 'buyer' ? resourceId : null);
    const vehicleId = request.params?.vehicleId || request.body?.vehicleId || request.query?.vehicleId
      || (resourceLower === 'vehicle' ? resourceId : null);
    const dealId = request.params?.dealId || request.body?.dealId || request.query?.dealId
      || (resourceLower === 'deal' ? resourceId : null);

    // Pre-handler: fetch current record for change tracking
    let previousRecord: Record<string, any> | null = null;
    if (metadata.trackChanges && (metadata.action === 'update' || metadata.action === 'delete')) {
      try {
        const modelName = RESOURCE_MODEL_MAP[resourceLower] || resourceLower;
        const model = this.prisma.getModel(modelName);
        if (model) {
          if (resourceId) {
            // Include receipts relation for extra-expense to track receiptIds changes
            const includeOpts = modelName === 'extraExpense' ? { include: { receipts: { select: { id: true } } } } : {};
            previousRecord = await model.findUnique({ where: { id: resourceId }, ...includeOpts });
            // Flatten receipts relation to receiptIds array for change comparison
            if (previousRecord?.receipts && Array.isArray(previousRecord.receipts)) {
              previousRecord.receiptIds = previousRecord.receipts.map((r: any) => r.id);
              delete previousRecord.receipts;
            }
          } else if (resourceLower === 'title' && vehicleId) {
            // Title upsert uses vehicleId param instead of id
            previousRecord = await model.findFirst({ where: { vehicleId } });
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch previous record for change tracking: ${err.message}`);
      }
    }

    return next.handle().pipe(
      tap(async (responseData) => {
        const duration = Date.now() - startTime;

        // After handler, request.user should be populated by the guard
        const userId = request.user?.id || cognitoSub || 'anonymous';
        const userEmail = request.user?.email || tokenEmail || 'unknown';

        // Resolve entity IDs from response data, previous record, or params
        let finalResourceId = resourceId;
        let finalVehicleId = vehicleId;
        let finalBuyerId = buyerId;
        let finalDealId = dealId;

        // For create actions, extract IDs from the response
        if (metadata.action === 'create' && responseData?.id) {
          finalResourceId = finalResourceId || responseData.id;
          if (resourceLower === 'vehicle') finalVehicleId = finalVehicleId || responseData.id;
          if (resourceLower === 'buyer') finalBuyerId = finalBuyerId || responseData.id;
          if (resourceLower === 'deal') finalDealId = finalDealId || responseData.id;
        }

        // Enrich entity IDs from previous record or response (for related resources like extra-expense)
        const refSource = previousRecord || responseData;
        if (refSource) {
          finalVehicleId = finalVehicleId || refSource.vehicleId || null;
          finalBuyerId = finalBuyerId || refSource.buyerId || null;
          finalDealId = finalDealId || refSource.dealId || null;

          // Handle polymorphic entities (e.g. Meta with entityType/entityId)
          if (refSource.entityType && refSource.entityId) {
            const et = refSource.entityType.toLowerCase();
            if (et === 'vehicle' && !finalVehicleId) finalVehicleId = refSource.entityId;
            if (et === 'buyer' && !finalBuyerId) finalBuyerId = refSource.entityId;
            if (et === 'deal' && !finalDealId) finalDealId = refSource.entityId;
          }
        }

        this.logger.log(
          `[AUDIT] ${metadata.action.toUpperCase()} ${metadata.resource} - User: ${userEmail} (${userId}) - IP: ${ip}`,
        );

        // Compute field-level changes for update operations
        let changes = this.computeChanges(previousRecord, request.body, metadata);

        // Resolve media IDs to URLs in changes (e.g. mainImageId → S3 URL)
        if (changes) {
          changes = await this.enrichMediaChanges(changes);
          changes = await this.enrichNomenclatorChanges(changes);
        }

        // For create actions, capture relevant response fields as summary
        let createdData = metadata.action === 'create' && responseData
          ? this.extractSummary(responseData, metadata)
          : null;

        // For delete actions, capture the deleted record summary
        let deletedData = metadata.action === 'delete' && previousRecord
          ? this.extractSummary(previousRecord, metadata)
          : null;

        // Resolve receipt references to URLs in summaries
        if (createdData?.receipts || createdData?.receiptIds) {
          createdData = await this.enrichReceiptSummary(createdData);
        }
        if (deletedData?.receipts || deletedData?.receiptIds) {
          deletedData = await this.enrichReceiptSummary(deletedData);
        }

        // Skip audit log for updates with no actual changes
        if (metadata.trackChanges && metadata.action === 'update' && !changes) {
          return;
        }

        // Crear registro de auditoría
        await this.createAuditLog({
          userId,
          userEmail,
          cognitoSub,
          tenantId,
          action: metadata.action,
          resource: metadata.resource,
          resourceId: finalResourceId,
          buyerId: finalBuyerId,
          vehicleId: finalVehicleId,
          dealId: finalDealId,
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
            bodyKeys: request.body ? Object.keys(request.body) : [],
            changes,
            createdData,
            deletedData,
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

  /**
   * Compute field-level changes between previous record and request body
   */
  private computeChanges(
    previousRecord: Record<string, any> | null,
    body: Record<string, any> | null,
    metadata: AuditLogMetadata,
  ): Record<string, { old: any; new: any }> | null {
    if (!previousRecord || !body) return null;

    const changes: Record<string, { old: any; new: any }> = {};
    const bodyKeys = Object.keys(body);

    // Skip internal/meta fields
    const skipFields = new Set(['id', 'createdAt', 'updatedAt', 'tenantId']);

    for (const key of bodyKeys) {
      if (skipFields.has(key)) continue;
      const oldVal = previousRecord[key];
      const newVal = body[key];

      // Skip if new value is undefined (not being changed)
      if (newVal === undefined) continue;

      // Normalize values for comparison (handle Decimal/number, Date, null, etc.)
      const normalize = (v: any): string => {
        if (v === null || v === undefined) return 'null';
        // Normalize dates: both Date objects and ISO strings to YYYY-MM-DD when possible
        if (v instanceof Date) return v.toISOString().split('T')[0];
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(v)) return v.split('T')[0];
        return v.toString?.() ?? String(v);
      };
      const oldStr = normalize(oldVal);
      const newStr = normalize(newVal);
      if (oldStr !== newStr) {
        if (metadata.pii) {
          // For PII resources, redact values but record that the field changed
          changes[key] = { old: '[REDACTED]', new: '[REDACTED]' };
        } else {
          changes[key] = { old: oldVal ?? null, new: newVal };
        }
      }
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  /**
   * Resolve fields ending in ImageId to their S3 URLs (e.g. mainImageId → url)
   */
  private async enrichMediaChanges(
    changes: Record<string, { old: any; new: any }>,
  ): Promise<Record<string, { old: any; new: any }>> {
    const mediaModel = this.prisma.getModel('media');
    if (!mediaModel) return changes;

    const enriched = { ...changes };

    for (const [field, diff] of Object.entries(enriched)) {
      // Handle receiptIds array field (many-to-many receipts)
      if (field === 'receiptIds') {
        try {
          const oldIds: string[] = Array.isArray(diff.old) ? diff.old : [];
          const newIds: string[] = Array.isArray(diff.new) ? diff.new : [];

          const oldSet = new Set(oldIds);
          const newSet = new Set(newIds);

          const addedIds = newIds.filter((id) => !oldSet.has(id));
          const removedIds = oldIds.filter((id) => !newSet.has(id));

          // Resolve all IDs to URLs
          const allIds = [...new Set([...addedIds, ...removedIds])];
          const mediaRecords = allIds.length > 0
            ? await mediaModel.findMany({
                where: { id: { in: allIds } },
                select: { id: true, url: true },
              })
            : [];
          const urlMap = new Map(mediaRecords.map((m: any) => [m.id, m.url]));

          const added = addedIds.map((id) => urlMap.get(id) || id);
          const removed = removedIds.map((id) => urlMap.get(id) || id);

          enriched['receipts'] = { old: removed, new: added };
          delete enriched[field];
        } catch (err) {
          this.logger.warn(`Failed to enrich receiptIds: ${err.message}`);
        }
        continue;
      }

      if (!field.endsWith('ImageId')) continue;

      // Resolve old and new media IDs to URLs
      try {
        const [oldMedia, newMedia] = await Promise.all([
          diff.old ? mediaModel.findUnique({ where: { id: diff.old }, select: { url: true } }) : null,
          diff.new ? mediaModel.findUnique({ where: { id: diff.new }, select: { url: true } }) : null,
        ]);

        // Replace the field name and values
        const displayField = field.replace(/Id$/, '');
        enriched[displayField] = {
          old: oldMedia?.url ?? diff.old,
          new: newMedia?.url ?? diff.new,
        };
        delete enriched[field];
      } catch (err) {
        this.logger.warn(`Failed to enrich media field ${field}: ${err.message}`);
      }
    }

    return enriched;
  }

  /**
   * Resolve receipt references to URLs inside a summary object (createdData / deletedData).
   * Handles both `receipts` (Media[] from create response) and `receiptIds` (UUID[] from delete).
   */
  private async enrichReceiptSummary(
    summary: Record<string, any>,
  ): Promise<Record<string, any>> {
    // Handle `receipts` — array of Media objects with url field (from create response)
    if (Array.isArray(summary.receipts) && summary.receipts.length > 0) {
      summary.receiptIds = summary.receipts.map((r: any) => r.url || r.id || r);
      delete summary.receipts;
      return summary;
    }
    delete summary.receipts;

    // Handle `receiptIds` — array of UUIDs (from delete with previousRecord)
    const ids: string[] = Array.isArray(summary.receiptIds) ? summary.receiptIds : [];
    if (ids.length === 0) {
      delete summary.receiptIds;
      return summary;
    }

    try {
      const mediaModel = this.prisma.getModel('media');
      const records = await mediaModel.findMany({
        where: { id: { in: ids } },
        select: { id: true, url: true },
      });
      const urlMap = new Map(records.map((m: any) => [m.id, m.url]));
      summary.receiptIds = ids.map((id) => urlMap.get(id) || id);
    } catch (err) {
      this.logger.warn(`Failed to enrich receiptIds in summary: ${err.message}`);
    }

    return summary;
  }

  /**
   * Resolve nomenclator/reference ID fields to their friendly display names
   * e.g. sourceId: { old: 'uuid1', new: 'uuid2' } → source: { old: 'Facebook', new: 'Walk-In' }
   */
  private async enrichNomenclatorChanges(
    changes: Record<string, { old: any; new: any }>,
  ): Promise<Record<string, { old: any; new: any }>> {
    const enriched = { ...changes };

    for (const [field, diff] of Object.entries(enriched)) {
      const mapping = NOMENCLATOR_FIELD_MAP[field];
      if (!mapping) continue;

      const model = this.prisma.getModel(mapping.model);
      if (!model) continue;

      try {
        const [oldRecord, newRecord] = await Promise.all([
          diff.old ? model.findUnique({ where: { id: diff.old }, select: { [mapping.displayField]: true } }) : null,
          diff.new ? model.findUnique({ where: { id: diff.new }, select: { [mapping.displayField]: true } }) : null,
        ]);

        const displayField = field.replace(/Id$/, '');
        enriched[displayField] = {
          old: oldRecord?.[mapping.displayField] ?? diff.old,
          new: newRecord?.[mapping.displayField] ?? diff.new,
        };
        delete enriched[field];
      } catch (err) {
        this.logger.warn(`Failed to enrich nomenclator field ${field}: ${err.message}`);
      }
    }

    return enriched;
  }

  /**
   * Extract a summary of relevant fields from a record (for create/delete logs)
   * Excludes internal fields and keeps only user-facing data
   */
  private extractSummary(
    record: Record<string, any>,
    metadata: AuditLogMetadata,
  ): Record<string, any> | null {
    if (!record || typeof record !== 'object') return null;

    // Serialize to plain object to handle class instances (e.g. ExtraExpenseEntity)
    let plain: Record<string, any>;
    try {
      plain = JSON.parse(JSON.stringify(record));
    } catch {
      return null;
    }

    // Use whitelist if defined for this resource, otherwise use skipFields
    const resourceLower = metadata.resource.toLowerCase();
    const whitelist = SUMMARY_FIELDS[resourceLower];

    const skipFields = new Set([
      'id', 'createdAt', 'updatedAt', 'tenantId',
      'password', 'hash', 'token', 'secret',
      'vehicleId', 'buyerId', 'dealId',
    ]);

    const summary: Record<string, any> = {};
    for (const [key, value] of Object.entries(plain)) {
      // If whitelist exists, only include whitelisted fields
      if (whitelist) {
        if (!whitelist.includes(key)) continue;
      } else {
        if (skipFields.has(key)) continue;
      }
      if (value === null || value === undefined) continue;
      // Allow arrays through for whitelisted fields, skip other objects
      if (typeof value === 'object' && !Array.isArray(value)) continue;

      if (metadata.pii) {
        summary[key] = '[REDACTED]';
      } else {
        summary[key] = value;
      }
    }

    return Object.keys(summary).length > 0 ? summary : null;
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
