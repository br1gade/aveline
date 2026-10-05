import { toCsv } from './csv';

describe('toCsv', () => {
  const lines = (csv: string) => csv.replace(/^\uFEFF/, '').trimEnd().split('\r\n');

  it('writes a header and one row per record', () => {
    const csv = toCsv(['name', 'seats'], [{ name: 'Armen', seats: 2 }]);

    expect(lines(csv)).toEqual(['"name","seats"', '"Armen","2"']);
  });

  // Without the BOM, Excel on Windows renders Armenian as mojibake.
  it('starts with a UTF-8 BOM', () => {
    expect(toCsv(['name'], [])).toMatch(/^\uFEFF/);
  });

  it('uses CRLF line endings', () => {
    expect(toCsv(['a'], [{ a: '1' }])).toBe('\uFEFF"a"\r\n"1"\r\n');
  });

  it.each([
    { label: 'a comma', value: 'Petrosyan, Armen', expected: '"Petrosyan, Armen"' },
    { label: 'a quote', value: 'O"Brien', expected: '"O""Brien"' },
    { label: 'a newline', value: 'line1\nline2', expected: '"line1\nline2"' },
    { label: 'Armenian text', value: 'Արմեն', expected: '"Արմեն"' },
  ])('escapes $label', ({ value, expected }) => {
    expect(lines(toCsv(['v'], [{ v: value }]))[1]).toBe(expected);
  });

  /**
   * A cell starting with `=` is executed by Excel. An export of guest-supplied
   * text is exactly where that becomes someone else's problem, so the value is
   * made inert while staying readable.
   */
  it.each(['=1+1', '+1', '-1', '@SUM(A1)'])('defuses %s rather than letting Excel run it', (value) => {
    expect(lines(toCsv(['v'], [{ v: value }]))[1]).toBe(`"\t${value}"`);
  });

  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'a missing column', value: undefined },
  ])('writes an empty cell for $label', ({ value }) => {
    expect(lines(toCsv(['v'], [{ v: value }]))[1]).toBe('""');
  });

  it('writes a header-only file for no rows', () => {
    expect(lines(toCsv(['name', 'seats'], []))).toEqual(['"name","seats"']);
  });

  it('keeps column order, not object key order', () => {
    const csv = toCsv(['b', 'a'], [{ a: '1', b: '2' }]);

    expect(lines(csv)).toEqual(['"b","a"', '"2","1"']);
  });
});
