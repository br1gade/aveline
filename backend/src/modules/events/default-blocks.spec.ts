import { BlockType } from '@prisma/client';
import { defaultBlocksFor } from './default-blocks';

describe('defaultBlocksFor', () => {
  const FULL = [
    BlockType.HERO,
    BlockType.STORY,
    BlockType.VENUE,
    BlockType.TIMELINE,
    BlockType.GALLERY,
    BlockType.RSVP,
  ];

  /**
   * The gap this closes: a new invitation had no blocks, so a host opened a
   * blank page and could publish it that way.
   */
  it('creates a block for every type the template supports', () => {
    expect(defaultBlocksFor(FULL).map((block) => block.type)).toEqual(FULL);
  });

  it('keeps the template’s own order', () => {
    const reversed = [...FULL].reverse();

    expect(defaultBlocksFor(reversed).map((block) => block.type)).toEqual(reversed);
    expect(defaultBlocksFor(reversed).map((block) => block.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  /**
   * A gallery with no photographs renders as an empty section, which looks
   * worse than not having one. The data-bound blocks are enabled because they
   * fill themselves from the event.
   */
  it('enables the blocks that are useful immediately', () => {
    const enabled = defaultBlocksFor(FULL)
      .filter((block) => block.enabled)
      .map((block) => block.type);

    expect(enabled).toEqual([BlockType.HERO, BlockType.VENUE, BlockType.TIMELINE, BlockType.RSVP]);
  });

  it.each([BlockType.STORY, BlockType.GALLERY])('creates %s but leaves it off', (type) => {
    const block = defaultBlocksFor(FULL).find((candidate) => candidate.type === type);

    expect(block).toMatchObject({ enabled: false });
  });

  // A template is free to support very little.
  it('handles a template that supports only an RSVP', () => {
    expect(defaultBlocksFor([BlockType.RSVP])).toEqual([
      { type: BlockType.RSVP, enabled: true, sortOrder: 0 },
    ]);
  });

  it('creates nothing for a template that declares no blocks', () => {
    expect(defaultBlocksFor([])).toEqual([]);
  });
});
