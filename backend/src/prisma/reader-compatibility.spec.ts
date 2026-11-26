import { assertReaderCompatibility, CURRENT_READER_REVISION } from './reader-compatibility';

describe('shared runtime reader compatibility', () => {
  it('requires revision 5 for manual renewal periods', () => {
    expect(CURRENT_READER_REVISION).toBe(5);
    expect(() => assertReaderCompatibility({ minimumRevision: 5 }, 4)).toThrow('compatibility');
  });
  it.each([2, 3, 4, 5])('allows the current reader to serve floor %i', (minimumRevision) => {
    expect(() => assertReaderCompatibility({ minimumRevision })).not.toThrow();
  });
  it.each([null, undefined, { minimumRevision: 6 }])('refuses missing or future floor %p', (gate) => {
    expect(() => assertReaderCompatibility(gate)).toThrow('compatibility');
  });
});
