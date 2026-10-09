import { BadRequestException } from '@nestjs/common';
import { BlockType } from '@prisma/client';
import { assertArrangementIsValid } from './arrangement.service';

/**
 * These guard the "one request, one consistent result" promise: a rejected
 * arrangement must be rejected whole, with a message naming what was wrong.
 */
describe('assertArrangementIsValid', () => {
  const supported = { supportedBlocks: [BlockType.HERO, BlockType.STORY, BlockType.RSVP], blockVariants: { HERO: ['split'] } };

  it('accepts an arrangement the template supports', () => {
    expect(() =>
      assertArrangementIsValid([{ type: BlockType.HERO }, { type: BlockType.RSVP }], supported),
    ).not.toThrow();
  });

  it('rejects a block the template cannot render, naming it', () => {
    expect(() =>
      assertArrangementIsValid([{ type: BlockType.HERO }, { type: BlockType.MAP }], supported),
    ).toThrow(/MAP/);
  });

  it('rejects a duplicated block type, naming it', () => {
    expect(() =>
      assertArrangementIsValid([{ type: BlockType.HERO }, { type: BlockType.HERO }], supported),
    ).toThrow(/HERO/);
  });

  it('throws BadRequest rather than a bare Error', () => {
    expect(() => assertArrangementIsValid([{ type: BlockType.MAP }], supported)).toThrow(
      BadRequestException,
    );
  });

  it('accepts a layout the template offers, and refuses one it does not, naming both', () => {
    expect(() => assertArrangementIsValid([{ type: BlockType.HERO, variant: 'split' }], supported)).not.toThrow();
    expect(() => assertArrangementIsValid([{ type: BlockType.HERO, variant: 'carousel' }], supported)).toThrow(/HERO.*carousel/);
    expect(() => assertArrangementIsValid([{ type: BlockType.STORY, variant: 'split' }], supported)).toThrow(/STORY takes no layout/);
  });

  it('accepts any arrangement when the template declares no restriction', () => {
    expect(() => assertArrangementIsValid([{ type: BlockType.MAP }], { supportedBlocks: [], blockVariants: {} })).not.toThrow();
  });
});
