import { BLOCK_TYPES, type BlockType } from '../types';
import type { BlockComponent } from './block-props';
import {
  CountdownBlock,
  DressCodeBlock,
  MapBlock,
  TimelineBlock,
  VenueBlock,
} from './event-blocks';
import { HeroBlock, ReplyBlock } from './layout-blocks';
import { GalleryBlock, MusicBlock } from './media-blocks';
import { ChatBlock, ContactBlock, NotesBlock, SignatureBlock, StoryBlock } from './text-blocks';

/** One component per block type (C-15). Adding a type is adding a row. */
export const BLOCKS: Record<BlockType, BlockComponent> = {
  HERO: HeroBlock,
  STORY: StoryBlock,
  COUNTDOWN: CountdownBlock,
  MUSIC: MusicBlock,
  VENUE: VenueBlock,
  MAP: MapBlock,
  TIMELINE: TimelineBlock,
  DRESS_CODE: DressCodeBlock,
  NOTES: NotesBlock,
  GALLERY: GalleryBlock,
  RSVP: ReplyBlock,
  SIGNATURE: SignatureBlock,
  CHAT: ChatBlock,
  CONTACT: ContactBlock,
};

function isBlockType(type: string): type is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(type);
}

/** The component for a block, or `undefined` for a type this release does not know: render nothing. */
export function blockComponent(type: string): BlockComponent | undefined {
  return isBlockType(type) ? BLOCKS[type] : undefined;
}
