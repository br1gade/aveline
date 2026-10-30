import { assertReaderCompatibility, CURRENT_READER_REVISION } from './reader-compatibility';

describe('shared runtime reader compatibility', () => {
  it('requires revision 3 for the combined enquiry and template readers', () => {
    expect(CURRENT_READER_REVISION).toBe(3);
    expect(() => assertReaderCompatibility({ minimumRevision: 3 }, 2)).toThrow('compatibility');
  });
  it.each([2, 3])('allows the current reader to serve floor %i', (minimumRevision) => {
    expect(() => assertReaderCompatibility({ minimumRevision })).not.toThrow();
  });
  it.each([null, undefined, { minimumRevision: 4 }])('refuses missing or future floor %p', (gate) => {
    expect(() => assertReaderCompatibility(gate)).toThrow('compatibility');
  });
});
