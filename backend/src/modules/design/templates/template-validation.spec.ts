import { validateTemplateDefinition } from './template-validation';
const valid = { name: 'New', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };
describe('template authoring bounds', () => {
  it('accepts bounded seed ceiling inputs without claiming renderer acceptance', () => {
    expect(validateTemplateDefinition(valid)).toEqual([]);
  });
  it.each(['css', 'html', 'script', 'brandVersionId'])('rejects unknown renderer input %s', (field) => {
    expect(validateTemplateDefinition({ ...valid, [field]: 'unsafe' })).toContainEqual(expect.objectContaining({ field }));
  });
  it('collects errors for unsupported fonts and duplicate or unknown block variants', () => {
    const errors = validateTemplateDefinition({ ...valid, allowedFonts: ['Remote Font'], blockVariants: { HERO: ['invented', 'invented'] }, supportedBlocks: [] });
    expect(errors.map((error) => error.field)).toEqual(expect.arrayContaining(['allowedFonts', 'supportedBlocks', 'blockVariants.HERO']));
  });
});
