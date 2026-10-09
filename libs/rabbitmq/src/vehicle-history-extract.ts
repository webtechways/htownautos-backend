/**
 * Contrato entre quien guarda un reporte nuevo (`vehicle-history` al
 * pedirlo, `carfax-analyzer` al subirlo a mano) o quien dispara un
 * reprocesamiento manual/masivo, y el consumidor en `data-sync` que corre la
 * extraccion con OpenAI (Task 1).
 *
 * Va por cola porque la extraccion es una llamada LLM y no debe bloquear la
 * respuesta de quien esta orquestando el reporte.
 */
export const VEHICLE_HISTORY_EXTRACT_QUEUE = 'vehicle-history.extract';

export interface VehicleHistoryExtractMessage {
  s3Key: string;
  trigger: 'new_report' | 'sweeper' | 'manual' | 'bulk';
  requestedByUserId?: string;
  force?: boolean;
}
