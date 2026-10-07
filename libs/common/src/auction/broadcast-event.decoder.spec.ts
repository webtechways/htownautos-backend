import {
  broadcastAuctionOf,
  bidNoPriceId,
  saleDayMMDDYYYY,
  decodeBroadcastMessage,
  normalizeBroadcastRoom,
  parseSocketIoEvent,
} from './broadcast-event.decoder';

// Mensajes reales del socket de difusion (copart-880-a, 2026-10-06).
const APERTURA =
  '42["event",{"auction":"copart-880-a","lot":56827376,"bid":4250,"order":1,"asking":4300,"reserve":false,"sold":false,"ticks":15,"round":1}]';
const PUJA =
  '42["event",{"auction":"copart-880-a","lot":56827376,"bid":4300,"country":"us","order":2,"asking":4350,"reserve":false,"sold":false,"ticks":10,"round":1}]';
const VENTA =
  '42["event",{"auction":"copart-880-a","lot":56827376,"bid":4450,"country":"us","order":5,"asking":4500,"reserve":false,"sold":true,"ticks":0,"round":2}]';

const AT = new Date('2026-10-07T02:29:47.590Z');

describe('decodeBroadcastMessage', () => {
  it('una puja en sala es BIDREC con su importe, lo pedido y el pais', () => {
    const d = decodeBroadcastMessage(PUJA, AT)!;
    expect(d.event).toBe('BIDREC');
    expect(d.rawEvent).toBe('BIDREC');
    expect(d.lot).toBe('56827376');
    expect(d.sale).toBe('COPART880A');
    expect(d.amount).toBe(4300);
    expect(d.askBid).toBe(4350);
    expect(d.increment).toBe(50);
    expect(d.buyerCountry).toBe('US');
    expect(d.emittedAt).toEqual(AT);
  });

  it('la apertura (order 1 sin pais) es PREBID', () => {
    expect(decodeBroadcastMessage(APERTURA, AT)!.event).toBe('PREBID');
  });

  it('sold:true es SOLD con el importe final', () => {
    const d = decodeBroadcastMessage(VENTA, AT)!;
    expect(d.event).toBe('SOLD');
    expect(d.amount).toBe(4450);
  });

  it('conserva el mensaje entero en payload', () => {
    const d = decodeBroadcastMessage(PUJA, AT)!;
    expect(d.payload).toMatchObject({ order: 2, ticks: 10, round: 1, reserve: false, _event: 'event' });
  });

  it('ping/pong y paquetes que no son eventos devuelven null', () => {
    expect(decodeBroadcastMessage('2', AT)).toBeNull();
    expect(decodeBroadcastMessage('3', AT)).toBeNull();
    expect(decodeBroadcastMessage('40', AT)).toBeNull();
    expect(decodeBroadcastMessage('0{"sid":"x"}', AT)).toBeNull();
    expect(decodeBroadcastMessage('42[roto', AT)).toBeNull();
  });

  it('otro nombre de evento sale como OTHER con su nombre', () => {
    const d = decodeBroadcastMessage('42["status",{"auction":"copart-880-a"}]', AT)!;
    expect(d.event).toBe('OTHER');
    expect(d.rawEvent).toBe('status');
  });
});

describe('helpers', () => {
  it('normaliza la sala al formato de Solace', () => {
    expect(normalizeBroadcastRoom('copart-880-a')).toBe('COPART880A');
    // La difusion no rellena la sede; Solace si.
    expect(normalizeBroadcastRoom('copart-25-a')).toBe('COPART025A');
    expect(normalizeBroadcastRoom('copart-9-b')).toBe('COPART009B');
    expect(normalizeBroadcastRoom('')).toBeNull();
  });

  it('parseSocketIoEvent saca nombre y datos', () => {
    expect(parseSocketIoEvent('42["event",{"a":1}]')).toEqual({ name: 'event', data: { a: 1 } });
  });
});

describe('bidNoPriceId', () => {
  const at = new Date('2026-10-07T14:10:00Z');

  it('es {order}-{sala}-{lote}-{MMDDYYYY}', () => {
    expect(bidNoPriceId('copart-154-b', 65900036, 16, at)).toBe('16-copart-154-b-65900036-10072026');
  });

  it('la misma puja da el mismo id venga como venga', () => {
    // foto inicial, round 2 y la venta comparten order
    expect(bidNoPriceId('COPART-361-A', '0064772516', 10, at)).toBe(bidNoPriceId('copart-361-a', 64772516, '10', at));
  });

  it('la fecha es la de Houston, no la UTC', () => {
    // 02:30 UTC del 8 = 21:30 del 7 en Houston
    expect(saleDayMMDDYYYY(new Date('2026-10-08T02:30:00Z'))).toBe('10072026');
  });

  it('sin sala, lote u order no hay id', () => {
    expect(bidNoPriceId('', 1, 1, at)).toBeNull();
    expect(bidNoPriceId('copart-1-a', null, 1, at)).toBeNull();
    expect(bidNoPriceId('copart-1-a', 5, null, at)).toBeNull();
  });
});

describe('IAAI (SalvageBid)', () => {
  // Real, 2026-10-07: sala iaa-643-c, order desde 0, sin pais en las de sala.
  const IAAI = '42["event",{"auction":"iaa-643-c","lot":45958357,"bid":null,"order":2,"asking":null,"reserve":false,"sold":false,"ticks":6,"round":1}]';
  const at = new Date('2026-10-07T14:40:00Z');

  it('distingue la subasta por la sala', () => {
    expect(broadcastAuctionOf('iaa-643-c')).toBe('iaai');
    expect(broadcastAuctionOf('copart-194-d')).toBe('copart');
    expect(broadcastAuctionOf('otra-1-a')).toBeNull();
  });

  it('se decodifica igual y sin importe', () => {
    const d = decodeBroadcastMessage(IAAI, at)!;
    expect(d.lot).toBe('45958357');
    expect(d.sale).toBe('IAA643C');
    expect(d.amount).toBeNull();
    expect(d.askBid).toBeNull();
    expect(d.buyerCountry).toBeNull();
  });

  it('order 0 tambien hace id', () => {
    expect(bidNoPriceId('iaa-643-c', 45958357, 0, at)).toBe('0-iaa-643-c-45958357-10072026');
  });
});
