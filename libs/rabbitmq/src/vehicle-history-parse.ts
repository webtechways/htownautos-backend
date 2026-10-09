/**
 * Contrato entre quien guarda un reporte de Carfax/AutoCheck (`vehicle-history`
 * al pedirlo, `carfax-analyzer` al subirlo a mano) y el consumidor en
 * `data-sync` que lo parsea a estructura (Task 2 hace el parseo real).
 *
 * Va por cola porque el parseo es CPU/LLM y no debe bloquear la respuesta al
 * que esta orquestando el reporte.
 */
export const VEHICLE_HISTORY_PARSE_QUEUE = 'vehicle-history.parse';

export interface VehicleHistoryParseMessage {
  s3Key: string;
}
