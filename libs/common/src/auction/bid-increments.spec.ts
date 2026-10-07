import {
  DEFAULT_COPART_BID_INCREMENTS as T,
  incrementFor,
  simulateFinalPrice,
  validateBidIncrements,
} from './bid-increments';

describe('Jumping Table', () => {
  it('elige el salto del tramo', () => {
    expect(incrementFor(T, 3)).toBe(1);
    expect(incrementFor(T, 99)).toBe(10);
    expect(incrementFor(T, 100)).toBe(25);
    expect(incrementFor(T, 4950)).toBe(50);
    expect(incrementFor(T, 5000)).toBe(100);
    expect(incrementFor(T, 120000)).toBe(1000);
  });

  it('simula el precio con el inicial y el numero de pujas', () => {
    expect(simulateFinalPrice(1000, 1, T)).toBe(1000);
    expect(simulateFinalPrice(1000, 3, T)).toBe(1100);
    // cruza de tramo: 4950 → 5000 (+50) → 5100 (+100)
    expect(simulateFinalPrice(4950, 3, T)).toBe(5100);
  });

  it('valida la tabla', () => {
    expect(validateBidIncrements(T)).toBeNull();
    expect(validateBidIncrements([])).toMatch(/vacia/);
    expect(validateBidIncrements([{ fromPrice: 5, increment: 5 }])).toMatch(/0/);
    expect(validateBidIncrements([{ fromPrice: 0, increment: 0 }])).toMatch(/mayor que 0/);
    expect(validateBidIncrements([{ fromPrice: 0, increment: 1 }, { fromPrice: 0, increment: 2 }])).toMatch(/repetido/);
  });
});
