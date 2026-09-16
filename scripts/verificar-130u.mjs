/**
 * Comprueba el mapeo del 130-U contra la plantilla REAL de DocuSeal.
 *
 * DocuSeal rellena por nombre de campo: si alguien renombra uno en el editor,
 * el nuestro deja de existir y el dato se pierde en silencio — el PDF sale con
 * el hueco en blanco y nadie se entera hasta que el condado lo rechaza. Esto lo
 * detecta en diez segundos.
 *
 * Hace dos cosas:
 *   1. Contrasta cada nombre del mapeo con los de la plantilla.
 *   2. Crea una submission de prueba con datos completos, comprueba que
 *      DocuSeal guarda todos los campos y la archiva.
 *
 * Uso:  DOCUSEAL=<token> node scripts/verificar-130u.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = process.env.DOCUSEAL_URL || 'https://docs.htownautos.com';
const TOKEN = process.env.DOCUSEAL;
const TEMPLATE_ID = 1;

if (!TOKEN) {
  console.error('Falta la variable DOCUSEAL');
  process.exit(1);
}

const pedir = async (ruta, init) => {
  const res = await fetch(`${BASE}/api${ruta}`, {
    ...init,
    headers: { 'X-Auth-Token': TOKEN, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${ruta} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

// El mapeo esta en TypeScript: se transpila al vuelo para no duplicarlo aqui.
const fuente = new URL('../apps/api/src/vehicle-documents/forms/form-130u.ts', import.meta.url).pathname;
execFileSync('npx', ['--yes', 'esbuild', fuente, '--format=esm', '--outfile=/tmp/f130-check.mjs', '--log-level=error']);
const { mapear130U } = await import('/tmp/f130-check.mjs');

const datos = {
  applyingFor: 'TITLE_ONLY',
  applicantType: 'INDIVIDUAL',
  applicantName: 'Prueba Automatica',
  mailingAddress: '1234 Main St', mailingCity: 'Houston', mailingState: 'TX', mailingZip: '77002',
  countyOfResidence: 'Harris', phone: '713-555-0100', email: 'prueba-borrar@htownautos.com',
  photoIdNumber: '12345678', idType: 'US_DRIVER_LICENSE', idIssuedBy: 'TX',
  vin: '3C6LRVAG4ME000000', year: '2021', make: 'RAM', model: 'ProMaster Cargo Van',
  bodyStyle: 'Van', majorColor: 'White', odometer: '84210', odometerBrand: 'NOT_ACTUAL',
  previousOwner: 'Copart, Dallas, TX', salesPrice: '12500', taxableAmount: '12500', totalDue: '781.25',
  physicallyInspected: true,
};
const values = mapear130U(datos);

// 1 · Todos los nombres tienen que existir en la plantilla.
const plantilla = await pedir(`/templates/${TEMPLATE_ID}`);
const existentes = new Set(plantilla.fields.map((f) => f.name));
const inventados = Object.keys(values).filter((k) => !existentes.has(k));
console.log(`plantilla "${plantilla.name}" · campos del mapeo: ${Object.keys(values).length}`);
if (inventados.length) {
  console.error('CAMPOS QUE NO EXISTEN EN LA PLANTILLA:');
  for (const c of inventados) console.error('  ✗', JSON.stringify(c));
} else {
  console.log('  ok  todos los nombres existen');
}

// 2 · Y DocuSeal tiene que guardarlos tal cual.
const [sub] = await pedir('/submissions', {
  method: 'POST',
  body: JSON.stringify({
    template_id: TEMPLATE_ID,
    send_email: false,
    submitters: [{ role: 'First Party', email: datos.email, values }],
  }),
});
const guardados = new Map((sub.values || []).map((v) => [v.field, v.value]));
const distintos = Object.entries(values).filter(([k, v]) => String(guardados.get(k)) !== String(v));
for (const [k, v] of distintos) {
  console.error(`  ✗ ${k}: enviado ${JSON.stringify(v)} · guardado ${JSON.stringify(guardados.get(k))}`);
}
if (!distintos.length) console.log(`  ok  DocuSeal guardo los ${guardados.size} campos sin cambios`);

await pedir(`/submissions/${sub.submission_id}`, { method: 'DELETE' });
console.log('  ok  submission de prueba archivada');

process.exit(inventados.length || distintos.length ? 1 : 0);
