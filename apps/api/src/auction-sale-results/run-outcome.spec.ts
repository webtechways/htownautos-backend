import { deriveRunOutcomes } from './run-outcome';

describe('deriveRunOutcomes', () => {
  it('marks earlier runs of the same lot as not_sold and the last one sold, with sequential attempts', () => {
    const rows = [
      { lot: '100', approved: false, reserveMet: false, pendingApproval: false },
      { lot: '100', approved: false, reserveMet: false, pendingApproval: false },
      { lot: '100', approved: true, reserveMet: false, pendingApproval: false },
    ];
    const result = deriveRunOutcomes(rows);
    expect(result.map((r) => r.outcome)).toEqual(['not_sold', 'not_sold', 'sold']);
    expect(result.map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect(result.every((r) => r.lotRuns === 3)).toBe(true);
  });

  it('treats approved === true as sold', () => {
    const [row] = deriveRunOutcomes([{ lot: '200', approved: true }]);
    expect(row.outcome).toBe('sold');
  });

  it('treats reserveMet === true as sold', () => {
    const [row] = deriveRunOutcomes([{ lot: '201', reserveMet: true }]);
    expect(row.outcome).toBe('sold');
  });

  it('treats pendingApproval === true as on_approval', () => {
    const [row] = deriveRunOutcomes([{ lot: '202', pendingApproval: true }]);
    expect(row.outcome).toBe('on_approval');
  });

  it('treats reserveMet === false (nothing else set) as reserve_not_met', () => {
    const [row] = deriveRunOutcomes([{ lot: '203', reserveMet: false }]);
    expect(row.outcome).toBe('reserve_not_met');
  });

  it('falls back to unknown for event rows with null flags', () => {
    const [row] = deriveRunOutcomes([
      { lot: '204', approved: null, reserveMet: null, pendingApproval: null },
    ]);
    expect(row.outcome).toBe('unknown');
  });

  it('flags relistedLater when a sold run is followed by a run under a different lot', () => {
    const rows = [
      { lot: '300', approved: true, finalBid: 5000 },
      { lot: '301', approved: false, reserveMet: false, pendingApproval: false },
    ];
    const result = deriveRunOutcomes(rows);
    expect(result[0].outcome).toBe('sold');
    expect(result[0].relistedLater).toBe(true);
    expect(result[0].price).toBe(5000);
    expect(result[1].relistedLater).toBe(false);
  });
});
