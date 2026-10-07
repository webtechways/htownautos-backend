import {
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
    expect(normalizeBroadcastRoom('')).toBeNull();
  });

  it('parseSocketIoEvent saca nombre y datos', () => {
    expect(parseSocketIoEvent('42["event",{"a":1}]')).toEqual({ name: 'event', data: { a: 1 } });
  });
});
