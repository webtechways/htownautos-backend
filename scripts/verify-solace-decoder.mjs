// Comprueba el decodificador contra frames reales de BIDREC y SOLD.
//   npx nx build api && F1=<frame> F2=<frame> node scripts/verify-solace-decoder.mjs
const { decodeSolaceFrame, normalizeLot, looksLikeAuctionFrame } =
  await import('../dist/apps/api/libs/common/src/auction/solace-frame.decoder.js');

const BIDREC = process.env.F1, SOLD = process.env.F2;
let fail = 0;
const ok = (l, c, d = '') => { console.log(`${c ? '  ok  ' : ' FAIL '} ${l}${d ? ' — ' + d : ''}`); if (!c) fail++; };

const b = decodeSolaceFrame(BIDREC);
ok('BIDREC: sala y evento', b?.sale === 'COPART833C' && b.event === 'BIDREC', `${b?.sale}/${b?.event}`);
ok('BIDREC: importe sale de CURBID', b.amount === 3200, String(b.amount));
ok('BIDREC: ask 3250, incremento 50', b.askBid === 3250 && b.increment === 50);
ok('BIDREC: lote sin ceros', b.lot === '54861156', b.lot);
ok('BIDREC: reserva alcanzada', b.reserveMet === true);
ok('BIDREC: comprador internacional', b.buyerNo === '753991' && b.buyerState === '19' && b.buyerCountry === 'IND');

const s = decodeSolaceFrame(SOLD);
ok('SOLD: sala y evento', s?.sale === 'COPART024A' && s.event === 'SOLD', `${s?.sale}/${s?.event}`);
ok('SOLD: importe sale de BID, no CURBID', s.amount === 9100, String(s.amount));
ok('SOLD: lote sin ceros', s.lot === '62015486', s.lot);
ok('SOLD: comprador de EEUU', s.buyerState === 'NJ' && s.buyerCountry === 'USA');
ok('SOLD: fecha de emision', s.emittedAt?.toISOString() === '2026-09-08T17:38:22.210Z', s.emittedAt?.toISOString());

ok('normalizeLot quita ceros', normalizeLot('0062015486') === '62015486');
ok('normalizeLot con basura', normalizeLot('  ') === null && normalizeLot(null) === null);
ok('triaje reconoce el frame', looksLikeAuctionFrame(Buffer.from(BIDREC,'base64').toString('binary')));
ok('triaje descarta ruido', !looksLikeAuctionFrame('keepalive'));
ok('frame corrupto no revienta', decodeSolaceFrame('no-es-base64-!!') === null);
ok('frame vacio no revienta', decodeSolaceFrame('') === null);

console.log(fail === 0 ? '\nTODO CORRECTO' : `\n${fail} fallo(s)`);
process.exitCode = fail ? 1 : 0;
