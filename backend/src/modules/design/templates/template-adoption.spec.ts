import { BlockType } from '@prisma/client';
import { planTemplateAdoption } from './template-adoption';
describe('explicit version adoption', () => {
  const source = { templateVersionId: 'v1', theme: { bodyFont: 'Inter' }, blocks: [
    { type: BlockType.HERO, enabled: true, variant: 'split', content: { en: 'kept' }, assetIds: ['event-photo'] },
    { type: BlockType.STORY, enabled: true, variant: null, content: { hy: 'kept too' }, assetIds: [] },
  ] };
  const target = { id: 'v2', supportedBlocks: [BlockType.HERO], blockVariants: { HERO: ['stacked'] }, defaultTheme: { palette: 'paper' } };
  it('resets a different version theme and unsupported variants without destroying copy or event uploads', () => {
    const result = planTemplateAdoption(source, target);
    expect(result.theme).toEqual(target.defaultTheme);
    expect(result.blocks).toEqual([{ ...source.blocks[0], variant: null }, { ...source.blocks[1], enabled: false }]);
    expect(result.changes.disabledBlocks).toEqual(['STORY']);
  });
  it('keeps theme only for the identical immutable version', () => {
    expect(planTemplateAdoption(source, { ...target, id: 'v1' }).theme).toEqual(source.theme);
  });
});
