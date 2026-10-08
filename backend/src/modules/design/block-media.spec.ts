import { BlockType, MediaKind } from '@prisma/client';
import { blockMediaProblem } from './block-media';

describe('blockMediaProblem', () => {
  it.each([
    [BlockType.MUSIC, MediaKind.AUDIO],
    [BlockType.HERO, MediaKind.PHOTO],
    [BlockType.HERO, MediaKind.COVER],
    [BlockType.GALLERY, MediaKind.PHOTO],
    [BlockType.CONTACT, MediaKind.LOGO],
  ])('accepts %s showing %s', (type, kind) => {
    expect(blockMediaProblem(type, [{ id: 'a1', kind }])).toBeNull();
  });

  it.each([
    [BlockType.MUSIC, MediaKind.PHOTO],
    [BlockType.HERO, MediaKind.AUDIO],
    [BlockType.GALLERY, MediaKind.AUDIO],
    [BlockType.STORY, MediaKind.DOCUMENT],
  ])('refuses %s showing %s, naming the field and the asset', (type, kind) => {
    expect(blockMediaProblem(type, [{ id: 'a1', kind }])).toMatch(/^assetIds: .*a1 is /);
  });

  it('names the first unacceptable asset among acceptable ones', () => {
    const assets = [
      { id: 'ok', kind: MediaKind.PHOTO },
      { id: 'song', kind: MediaKind.AUDIO },
    ];
    expect(blockMediaProblem(BlockType.GALLERY, assets)).toContain('song is AUDIO');
  });

  it('accepts no assets at all, which is how a host clears a block', () => {
    expect(blockMediaProblem(BlockType.HERO, [])).toBeNull();
  });
});
