import { serializeBigInts } from './serialize';

/**
 * BigInt is not JSON-serialisable: JSON.stringify throws on it. Nine places
 * were converting money by hand, which meant every new endpoint touching an
 * amount had to remember — and the one that forgot would 500 at runtime.
 */
describe('serializeBigInts', () => {
  it('converts a bigint to a string, preserving precision beyond a float', () => {
    expect(serializeBigInts(9007199254740993n)).toBe('9007199254740993');
  });

  it('converts bigints nested in objects', () => {
    expect(serializeBigInts({ amountMinor: 25000n, currency: 'AMD' })).toEqual({
      amountMinor: '25000',
      currency: 'AMD',
    });
  });

  it('converts bigints inside arrays', () => {
    expect(serializeBigInts([{ price: 1n }, { price: 2n }])).toEqual([
      { price: '1' },
      { price: '2' },
    ]);
  });

  it('converts deeply nested bigints', () => {
    expect(serializeBigInts({ order: { items: [{ unitPriceMinor: 700n }] } })).toEqual({
      order: { items: [{ unitPriceMinor: '700' }] },
    });
  });

  it.each([
    { value: null, label: 'null' },
    { value: undefined, label: 'undefined' },
    { value: 'text', label: 'a string' },
    { value: 42, label: 'a number' },
    { value: true, label: 'a boolean' },
  ])('leaves $label untouched', ({ value }) => {
    expect(serializeBigInts(value)).toBe(value);
  });

  it('leaves Date objects intact so they still serialise as ISO strings', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(serializeBigInts({ at: date })).toEqual({ at: date });
  });

  it('produces output JSON.stringify accepts', () => {
    const payload = serializeBigInts({ total: 30000n, items: [{ price: 15000n }] });
    expect(() => JSON.stringify(payload)).not.toThrow();
  });
});
