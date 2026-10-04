import { BadRequestException } from '@nestjs/common';
import { BlockType } from '@prisma/client';
import { assertArrangementIsValid } from './arrangement.service';

/**
 * These guard the "one request, one consistent result" promise: a rejected
 * arrangement must be rejected whole, with a message naming what was wrong.
 */
describe('assertArrangementIsValid', () => {
  const supported = [BlockType.HERO, BlockType.STORY, BlockType.RSVP];

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

  it('accepts any arrangement when the template declares no restriction', () => {
    expect(() => assertArrangementIsValid([{ type: BlockType.MAP }], [])).not.toThrow();
  });
});
