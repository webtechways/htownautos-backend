import { decodeSolaceFrame } from './solace-frame.decoder';

/** Monta un frame como el de Solace: topic en claro + sobre base64 + data base64. */
function frame(event: string, payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64');
  const envelope = {
    '@class': 'com.copart.auction.MessageEvent',
    sale: 'COPART881A',
    event,
    metadata: { emitTimestamp: 1791333691106 },
    data: b64(payload),
  };
  return Buffer.from(`\u0003auction/outbound/COPART881A\u0000${b64(envelope)}`, 'binary').toString('base64');
}

describe('decodeSolaceFrame', () => {
  it('PREBID lleva el importe en el campo PREBID', () => {
    // Payload real de produccion (lote 70120126).
    const d = decodeSolaceFrame(
      frame('PREBID', {
        TYPE: 'P', LOTNO: '70120126', '@class': 'com.copart.auction.messagerecords.PREBIDMessage',
        APRFLG: 'N', MINMET: 'N', PREBID: '2550', BUYERNO: '59216', BUYERST: 'HN', BUYERCTR: 'HND',
        EVENTCODE: 'PRCD', FORMATNAME: 'PREBID',
      }),
    )!;
    expect(d.event).toBe('PREBID');
    expect(d.amount).toBe(2550);
    expect(d.buyerCountry).toBe('HND');
  });

  it('BIDREC sigue leyendo CURBID', () => {
    const d = decodeSolaceFrame(
      frame('BIDREC', { LOTNO: '0058755636', CURBID: '7600', ASKBID: '7700', INCREMENT: '100', ITEMNO: '3007' }),
    )!;
    expect(d.lot).toBe('58755636');
    expect(d.amount).toBe(7600);
    expect(d.askBid).toBe(7700);
  });

  it('SOLD lee BID', () => {
    expect(decodeSolaceFrame(frame('SOLD', { LOTNO: '1', BID: '4450' }))!.amount).toBe(4450);
  });
});
