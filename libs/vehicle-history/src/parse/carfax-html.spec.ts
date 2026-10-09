import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCarfaxHtml } from './carfax-html';

const fixture = readFileSync(join(__dirname, '__fixtures__/carfax-html.fixture.html'), 'utf-8');

describe('parseCarfaxHtml', () => {
  it('extracts summary flags, odometer readings, damage events and ownership from the detailed history table', () => {
    const result = parseCarfaxHtml(fixture);

    expect(result.summary.structuralDamage).toBe(false);
    expect(result.summary.airbagDeployed).toBe(false);
    expect(result.summary.odometerRollbackSuspected).toBe(false);
    expect(result.summary.serviceRecordCount).toBe(8);
    expect(result.summary.openRecallCount).toBe(1);
    expect(result.summary.usageTypes).toContain('personal');
    expect(result.summary.lastReportedState).toBe('TX');
    expect(result.summary.brandedTitle).toBe(true);
    expect(result.summary.salvage).toBe(true);

    expect(result.odometerReadings.length).toBeGreaterThanOrEqual(3);
    expect(result.odometerReadings[0]).toEqual({ date: '2018-03-21', miles: 10, source: 'dealer_or_service_shop' });

    expect(result.damageEvents.some((e) => e.kind === 'damage' && e.severity === 'minor')).toBe(true);

    expect(result.ownershipPeriods[0]).toMatchObject({ ownerIndex: 1, usageType: 'personal', start: '2018-01-01' });

    expect(result.titleEvents.length).toBeGreaterThan(0);
    expect(result.titleEvents[0].state).toBe('TX');

    // Never leak the raw dealer name — only a coarse category.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('REDACTED DEALER');
  });
});
