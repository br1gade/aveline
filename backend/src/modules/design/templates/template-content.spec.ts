import { pinnedTemplate, hashTemplateContent } from './template-content';

describe('immutable rendering inputs', () => {
  const baseline = { name: 'Odd baseline', allowedFonts: ['B', 'A'], palettes: null, supportedBlocks: [], blockVariants: { HERO: ['old'] }, defaultTheme: { colors: ['#abc'], odd: null } };
  it('keeps an invitation baseline verbatim after its catalogue identity changes', () => {
    const identity = { id: 'template', key: 'classic', ...baseline, defaultTheme: { changed: true } };
    expect(pinnedTemplate({ template: identity, templateVersion: baseline })).toEqual({ ...identity, ...baseline });
  });
  it('hashes object keys canonically without reordering arrays or coercing null', () => {
    expect(hashTemplateContent({ a: 1, b: null })).toBe(hashTemplateContent({ b: null, a: 1 }));
    expect(hashTemplateContent(['B', 'A'])).not.toBe(hashTemplateContent(['A', 'B']));
    expect(hashTemplateContent({ value: null })).not.toBe(hashTemplateContent({}));
  });
});
