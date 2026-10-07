import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { houstonYmd, iaaiLaneCodes, parseIaaiBranchCalendar } from './iaai-branch-calendar';

// Recorte real de https://www.iaai.com/branchlocations (2026-10-07):
// Abilene, Manchester y una sede sin subasta programada.
const html = readFileSync(join(__dirname, '__fixtures__/branchlocations.html'), 'utf8');

describe('parseIaaiBranchCalendar', () => {
  const filas = parseIaaiBranchCalendar(html, 4);

  it('una fila por sede con subasta; descarta las que no tienen', () => {
    expect(filas.map((f) => f.branchName).sort()).toEqual(['Abilene', 'Manchester']);
  });

  it('Manchester = sede 643, la de la sala iaa-643-c', () => {
    const m = filas.find((f) => f.branchNumber === 643)!;
    expect(m.auctionId).toBe('180132~US');
    expect(m.startedAt.toISOString()).toBe('2026-10-07T13:30:00.000Z');
    expect(m.saleDate).toBe(20261007);
    expect(m.numberOfVehicles).toBe(311);
    expect(m.laneCodes).toEqual(['iaa-643-a', 'iaa-643-b', 'iaa-643-c', 'iaa-643-d']);
    expect(m.state).toBe('NH');
  });

  it('no guarda metadatos de serializacion ni imagenes en raw', () => {
    expect(filas[0].raw).not.toHaveProperty('$id');
    expect(filas[0].raw).not.toHaveProperty('branchImages');
  });

  it('pagina sin el JSON → error claro (bloqueo o cambio de pagina)', () => {
    expect(() => parseIaaiBranchCalendar('<html>Access denied</html>')).toThrow(/locationsListVM/);
  });
});

describe('helpers', () => {
  it('lanes candidatas', () => {
    expect(iaaiLaneCodes(643, 3)).toEqual(['iaa-643-a', 'iaa-643-b', 'iaa-643-c']);
  });
  it('fecha de Houston', () => {
    expect(houstonYmd(new Date('2026-10-08T03:00:00Z'))).toBe(20261007);
  });
});
