import { BlockType } from '@prisma/client';

/**
 * The blocks a brand-new invitation starts with.
 *
 * Without this a newly created invitation has no blocks at all, so a host
 * creates an event, opens the page and finds it blank — and can publish it in
 * that state. `DesignTemplate.supportedBlocks` is documented in the schema as
 * the template's block types "in their default order", which is exactly the
 * list to build from.
 *
 * Every supported block is created so the host can see what the template
 * offers, but only a core set is **enabled**. A GALLERY with no photographs
 * and a STORY with no words render as empty sections, which looks worse than
 * their absence; the data-bound ones are enabled because they fill themselves
 * from the event that was just created.
 *
 * Pure, because which blocks a host should find already on their page is a
 * product decision, not a database detail.
 */
const ENABLED_BY_DEFAULT: readonly BlockType[] = [
  // Names, date, the thing a guest sees first.
  BlockType.HERO,
  // Hydrated from the event's venues and timeline, so they are never empty.
  BlockType.VENUE,
  BlockType.TIMELINE,
  BlockType.COUNTDOWN,
  // The point of the whole page.
  BlockType.RSVP,
];

export interface DefaultBlock {
  type: BlockType;
  enabled: boolean;
  sortOrder: number;
}

export function defaultBlocksFor(supportedBlocks: readonly BlockType[]): DefaultBlock[] {
  return supportedBlocks.map((type, index) => ({
    type,
    enabled: ENABLED_BY_DEFAULT.includes(type),
    // The template's own order, so a template author decides how their page
    // reads rather than the enum's declaration order deciding for them.
    sortOrder: index,
  }));
}
