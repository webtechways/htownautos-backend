import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'auditLog';

export interface AuditLogMetadata {
  action: string; // create, read, update, delete, export, access
  resource: string; // buyer, deal, vehicle, media, etc.
  level: 'low' | 'medium' | 'high' | 'critical'; // Nivel de sensibilidad
  pii: boolean; // Personally Identifiable Information
  compliance?: string[]; // ['routeone', 'dealertrack', 'glba', 'ofac']
  trackChanges?: boolean; // When true, fetch old record and compute field-level diff
}

/**
 * Decorator para marcar endpoints que requieren auditoría
 * Requerido por RouteOne y DealerTrack para compliance
 */
export const AuditLog = (metadata: AuditLogMetadata) => SetMetadata(AUDIT_LOG_KEY, metadata);
