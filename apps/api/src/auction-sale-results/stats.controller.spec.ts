import { StatsController } from './stats.controller';

function makeStatsMock() {
  return {
    search: jest.fn().mockResolvedValue({
      data: [{ id: '1', lot: '123', finalBid: 5000 }],
      meta: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false },
    }),
    findByLot: jest.fn().mockResolvedValue({ id: '1', lot: '123', finalBid: 5000 }),
    priceStats: jest.fn().mockResolvedValue({
      muestra: 20,
      suficiente: true,
      precio: { mediana: 5000, p25: 4000, p75: 6000, minimo: 2000, maximo: 9000, media: 5100 },
      odometroMediana: 60000,
    }),
    breakdown: jest.fn().mockResolvedValue([{ grupo: '2020', muestra: 20, suficiente: true, medianaPrecio: 5000 }]),
    getFilters: jest.fn(),
  } as any;
}

describe('StatsController — price masking (auction-stats:read)', () => {
  let stats: ReturnType<typeof makeStatsMock>;
  let controller: StatsController;

  beforeEach(() => {
    stats = makeStatsMock();
    controller = new StatsController(stats);
  });

  it('search: anonymous caller (no req.user) gets finalBid: null + priceHidden: true', async () => {
    const result = await controller.search({} as any, { user: undefined } as any);
    expect(result.data[0]).toMatchObject({ finalBid: null, priceHidden: true });
  });

  it('search: an authorized caller (req.user set — staff, or customer with the permission) sees the real price', async () => {
    const result = await controller.search({} as any, { user: { id: 'u1' } } as any);
    expect(result.data[0]).toMatchObject({ finalBid: 5000 });
    expect(result.data[0].priceHidden).toBeUndefined();
  });

  it('findByLot: anonymous gets finalBid masked', async () => {
    const result = await controller.findByLot('123', undefined, { user: undefined } as any);
    expect(result).toMatchObject({ finalBid: null, priceHidden: true });
  });

  it('findByLot: logged-in caller gets the real price', async () => {
    const result = await controller.findByLot('123', undefined, { user: { id: 'u1' } } as any);
    expect(result).toMatchObject({ finalBid: 5000 });
  });

  it('priceStats: anonymous gets precio: null + priceHidden: true', async () => {
    const result = await controller.priceStats({} as any, { user: undefined } as any);
    expect(result).toMatchObject({ precio: null, priceHidden: true });
  });

  it('priceStats: logged-in caller keeps the real distribution', async () => {
    const result = await controller.priceStats({} as any, { user: { id: 'u1' } } as any);
    expect(result.precio).toMatchObject({ mediana: 5000 });
    expect((result as any).priceHidden).toBeUndefined();
  });

  it('breakdown: anonymous gets medianaPrecio masked per group', async () => {
    const result = await controller.breakdown({} as any, 'year', undefined, { user: undefined } as any);
    expect(result[0]).toMatchObject({ medianaPrecio: null, priceHidden: true });
  });

  it('breakdown: logged-in caller keeps the real medianaPrecio', async () => {
    const result = await controller.breakdown({} as any, 'year', undefined, { user: { id: 'u1' } } as any);
    expect(result[0]).toMatchObject({ medianaPrecio: 5000 });
  });
});
