import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCarfaxPdfText } from './carfax-pdf';

const fixture = readFileSync(join(__dirname, '__fixtures__/carfax-pdf.fixture.txt'), 'utf-8');

describe('parseCarfaxPdfText', () => {
  it('extracts summary flags and odometer/damage rows from the text-based Carfax PDF layout', () => {
    const result = parseCarfaxPdfText(fixture);

    expect(result.summary.totalLoss).toBe(false);
    expect(result.summary.structuralDamage).toBe(false);
    expect(result.summary.airbagDeployed).toBe(false);
    expect(result.summary.odometerRollbackSuspected).toBe(false);
    expect(result.summary.serviceRecordCount).toBe(33);
    expect(result.summary.ownerCount).toBe(1);
    expect(result.summary.lastReportedState).toBe('TX');

    expect(result.odometerReadings.length).toBeGreaterThan(0);
    expect(result.odometerReadings.find((r) => r.miles === 4621)).toBeTruthy();

    expect(result.damageEvents.some((e) => e.kind === 'damage')).toBe(true);
    expect(result.titleEvents.length).toBeGreaterThan(0);
  });
});
