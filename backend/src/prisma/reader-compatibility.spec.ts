import { assertReaderCompatibility, CURRENT_READER_REVISION } from './reader-compatibility';

describe('shared runtime reader compatibility', () => {
  it('requires revision 4 for durable payment attempts and uncertainty handling', () => {
    expect(CURRENT_READER_REVISION).toBe(4);
    expect(() => assertReaderCompatibility({ minimumRevision: 4 }, 3)).toThrow('compatibility');
  });
  it.each([2, 3, 4])('allows the current reader to serve floor %i', (minimumRevision) => {
    expect(() => assertReaderCompatibility({ minimumRevision })).not.toThrow();
  });
  it.each([null, undefined, { minimumRevision: 5 }])('refuses missing or future floor %p', (gate) => {
    expect(() => assertReaderCompatibility(gate)).toThrow('compatibility');
  });
});
