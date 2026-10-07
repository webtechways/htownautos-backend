import { MarketAnalyticsService, houstonToday, niceStep, shiftYmd } from './market-analytics.service';

describe('helpers', () => {
  it('shiftYmd cruza meses y años', () => {
    expect(shiftYmd(20261001, -1)).toBe(20260930);
    expect(shiftYmd(20261231, 1)).toBe(20270101);
    expect(shiftYmd(20260301, -1)).toBe(20260228);
  });

  it('houstonToday usa la fecha de Houston, no la UTC', () => {
    // 03:00 UTC del 8 = 22:00 del 7 en Houston
    expect(houstonToday(new Date('2026-10-08T03:00:00Z'))).toBe(20261007);
  });

  it('niceStep da pasos redondos', () => {
    expect(niceStep(9000, 30)).toBe(500);
    expect(niceStep(30000, 30)).toBe(1000);
    expect(niceStep(1200, 30)).toBe(50);
    expect(niceStep(5, 30)).toBe(1);
  });
});

describe('MarketAnalyticsService', () => {
  const titleMapping = { getOverrides: jest.fn().mockResolvedValue({}) };
  const queryRaw = jest.fn();
  const svc = new MarketAnalyticsService({ $queryRaw: queryRaw } as any, titleMapping as any);
  beforeEach(() => {
    queryRaw.mockReset();
    svc.clearCache();
  });

  it('el WHERE va parametrizado (nada del usuario en el texto SQL)', async () => {
    const w = await svc.where({ make: ["TOYOTA'; DROP TABLE x;--"], yearMin: 2015 } as any);
    expect(w.sql).not.toContain('DROP');
    expect(w.values).toContain("TOYOTA'; DROP TABLE x;--");
    expect(w.values).toContain(2015);
  });

  it('trend: cubos con poca muestra no dan banda', async () => {
    queryRaw.mockResolvedValue([
      { t: new Date('2026-09-07'), n: 50n, p25: 1000, p50: 2000.4, p75: 3000 },
      { t: new Date('2026-09-14'), n: 3n, p25: 1, p50: 2, p75: 3 },
    ]);
    const out = await svc.trend({} as any);
    expect(out.muestra).toBe(53);
    expect(out.points[0]).toEqual({ t: '2026-09-07', n: 50, p25: 1000, p50: 2000, p75: 3000 });
    expect(out.points[1].p50).toBeNull();
  });

  it('distribution: cubos completos con la cola en el ultimo', async () => {
    queryRaw
      .mockResolvedValueOnce([{ n: 100n, p50: 2300, p97: 9000, mean: 2900 }])
      .mockResolvedValueOnce([{ b: 0, n: 40n }, { b: 4, n: 50n }, { b: 18, n: 10n }]);
    const out = await svc.distribution({} as any);
    expect(out.step).toBe(500);
    expect(out.bins).toHaveLength(19);
    expect(out.bins[1].n).toBe(0);
    expect(out.bins[18]).toEqual({ from: 9000, to: null, n: 10 });
    expect(out.median).toBe(2300);
  });

  it('distribution sin datos', async () => {
    queryRaw.mockResolvedValueOnce([{ n: 0n, p50: null, p97: null, mean: null }]);
    const out = await svc.distribution({} as any);
    expect(out).toMatchObject({ muestra: 0, suficiente: false, bins: [] });
  });

  it('cachea por filtros', async () => {
    queryRaw.mockResolvedValue([]);
    await svc.trend({ make: ['A'] } as any);
    await svc.trend({ make: ['A'] } as any);
    await svc.trend({ make: ['B'] } as any);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

});
