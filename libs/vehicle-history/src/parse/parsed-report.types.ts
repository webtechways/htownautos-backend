/**
 * Shared contract between the parser (Task 2) and the consumer/sweeper/read
 * endpoint built in Task 1. `PARSER_VERSION` gates reprocessing: rows parsed
 * with an older version get re-queued by the sweeper.
 */
export const PARSER_VERSION = 1;

export type SectionStatus = 'parsed' | 'llm' | 'missing';

export interface ParsedVehicleHistory {
  vin: string;
  reportType: 'carfax' | 'autocheck';
  template: string; // 'carfax-html-cheap','carfax-pdf-globalvin','carfax-pdf-upload','autocheck-html','autocheck-pdf','unknown'
  status: 'ok' | 'partial' | 'unsupported' | 'failed';
  confidence: number; // 0..1
  reportDate: string | null; // ISO date
  summary: {
    accidentCount: number | null;
    damageReportCount: number | null;
    structuralDamage: boolean | null;
    airbagDeployed: boolean | null;
    titleBrands: string[];
    brandedTitle: boolean | null;
    totalLoss: boolean | null;
    salvage: boolean | null;
    flood: boolean | null;
    lemon: boolean | null;
    ownerCount: number | null;
    lastOdometer: number | null;
    lastOdometerDate: string | null;
    odometerRollbackSuspected: boolean | null;
    usageTypes: string[]; // personal|commercial|rental|fleet|taxi|police|lease|government
    serviceRecordCount: number | null;
    openRecallCount: number | null;
    lastReportedState: string | null;
  };
  odometerReadings: { date: string | null; miles: number; source: string | null }[];
  damageEvents: {
    date: string | null;
    kind: 'accident' | 'damage' | 'airbag' | 'structural' | 'total_loss' | 'other';
    severity: string | null;
    area: string | null;
    airbag: boolean | null;
    description: string | null;
  }[];
  titleEvents: { date: string | null; state: string | null; brand: string | null; kind: string | null; odometer: number | null }[];
  ownershipPeriods: {
    ownerIndex: number;
    start: string | null;
    end: string | null;
    usageType: string | null;
    state: string | null;
    milesPerYear: number | null;
  }[];
  sections: Record<string, SectionStatus>;
  llmSections: string[];
  raw: unknown; // raw without PII
}

export type ParseFn = (input: {
  body: Buffer;
  contentType: string;
  vin?: string | null;
  reportType?: string | null;
}) => Promise<ParsedVehicleHistory>;
