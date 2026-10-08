import { copartBroadcastRooms } from './broadcast-rooms.service';

describe('copartBroadcastRooms', () => {
  it('con lanes en el calendario, esas', () => {
    expect(copartBroadcastRooms(25, { lanes: [{ lane: 'A' }, { lane: 'B' }] })).toEqual(['copart-25-a', 'copart-25-b']);
  });

  it('junta lanes, liveLanes y laterLanes sin repetir', () => {
    expect(copartBroadcastRooms(5, { lanes: [{ lane: 'A' }], liveLanes: [{ lane: 'A' }, { lane: 'C' }], laterLanes: [] })).toEqual(['copart-5-a', 'copart-5-c']);
  });

  it('sin lanes todavia (upcoming), las candidatas A-E', () => {
    // Caso real: NCS Central Region (881) en vivo a las 20:00 con lanes: []
    expect(copartBroadcastRooms(881, { lanes: [], liveLanes: [], laterLanes: [] })).toEqual([
      'copart-881-a', 'copart-881-b', 'copart-881-c', 'copart-881-d', 'copart-881-e',
    ]);
    expect(copartBroadcastRooms(881, null)).toHaveLength(5);
  });
});

import { BroadcastRoomsService } from './broadcast-rooms.service';

describe('BroadcastRoomsService: candidatas que no se presentan', () => {
  const ahora = Date.UTC(2026, 9, 8, 15, 0);
  const min = (m: number) => new Date(ahora + m * 60_000);
  const entrada = (startedAt: Date, extra: object = {}) => ({
    locationSourceId: 881, raw: { lanes: [] }, endedLanes: [], startedAt, manualStatus: null, ...extra,
  });

  function svc(entradas: object[], actividad: Array<{ room: string; last: Date }>) {
    const prisma = {
      auctionCalendarEntry: { findMany: jest.fn().mockResolvedValue(entradas) },
      iaaiCalendarEntry: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue(actividad),
    };
    return new BroadcastRoomsService(prisma as any);
  }
  const live = async (s: BroadcastRoomsService) => {
    jest.spyOn(Date, 'now').mockReturnValue(ahora);
    try {
      return (await s.live(15, 'copart')).rooms;
    } finally {
      jest.restoreAllMocks();
    }
  };

  it('antes de 30 min se dan las 5 candidatas', async () => {
    const r = await live(svc([entrada(min(-20))], [{ room: 'copart-881-a', last: min(-1) }]));
    expect(r).toHaveLength(5);
  });

  it('pasados 30 min solo quedan las que tuvieron eventos (con o sin precio)', async () => {
    const r = await live(svc([entrada(min(-45))], [
      { room: 'copart-881-a', last: min(-1) }, // bid_no_price
      { room: 'COPART881B', last: min(-2) },   // auction_bid_events (Solace / con precio)
    ]));
    expect(r).toEqual(['copart-881-a', 'copart-881-b']);
  });

  it('si la captura de Copart esta caida no se quita nada', async () => {
    const r = await live(svc([entrada(min(-45))], [{ room: 'copart-5-a', last: min(-60) }]));
    expect(r).toHaveLength(5);
  });

  it('las lanes reales del calendario no se tocan', async () => {
    const r = await live(svc([entrada(min(-45), { raw: { lanes: [{ lane: 'A' }, { lane: 'B' }] } })], [{ room: 'copart-1-a', last: min(-1) }]));
    expect(r).toEqual(['copart-881-a', 'copart-881-b']);
  });

  it('una subasta abierta a mano conserva sus candidatas', async () => {
    const r = await live(svc([entrada(min(-45), { manualStatus: 'live' })], [{ room: 'copart-1-a', last: min(-1) }]));
    expect(r).toHaveLength(5);
  });
});
