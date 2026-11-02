import { validateTemplateDefinition } from './template-validation';

/** docs/API.md, "Immutable invitation templates": the whole definition is at most 64KiB. */
const valid = { name: 'New', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
const LIMIT = 65536;

/** Pads an otherwise valid definition with one extra field so its JSON is exactly `bytes` long. */
function definitionOfSize(bytes: number): Record<string, unknown> {
  const empty = Buffer.byteLength(JSON.stringify({ ...valid, padding: '' }));
  const padded = { ...valid, padding: 'x'.repeat(bytes - empty) };
  expect(Buffer.byteLength(JSON.stringify(padded))).toBe(bytes);
  return padded;
}
const sizeErrors = (input: unknown) => validateTemplateDefinition(input).filter((error) => error.field === 'definition');

describe('template definition aggregate size', () => {
  it('accepts a definition of exactly 64KiB', () => {
    expect(sizeErrors(definitionOfSize(LIMIT))).toEqual([]);
  });

  it('refuses a definition one byte over 64KiB, naming the definition', () => {
    expect(sizeErrors(definitionOfSize(LIMIT + 1))).toEqual([{ field: 'definition', message: 'at most 64KiB' }]);
  });

  it('counts multi-byte characters by their encoded size, not their length', () => {
    const empty = Buffer.byteLength(JSON.stringify({ ...valid, padding: '' }));
    const armenian = { ...valid, padding: 'Ա'.repeat(Math.ceil((LIMIT - empty) / 2) + 1) };
    expect(JSON.stringify(armenian).length).toBeLessThan(LIMIT);
    expect(sizeErrors(armenian)).toEqual([{ field: 'definition', message: 'at most 64KiB' }]);
  });
});
