export { VehicleHistoryModule } from './vehicle-history.module';
export { VehicleHistoryService, normalizeVin } from './vehicle-history.service';
export type { RequestView, AttemptEntry, OrderInput } from './vehicle-history.service';
export { ADAPTERS } from './providers';
export * from './types';
export { parseVehicleHistory } from './parse/index';
export * from './parse/parsed-report.types';
