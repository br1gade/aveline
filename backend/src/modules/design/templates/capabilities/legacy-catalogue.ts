import { BlockType } from '@prisma/client';

/** Backend seed ceiling only: these names are not evidence of tested frontend rendering. */
export const LEGACY_CATALOGUE = {
  rendererKey: 'invitation-v1',
  fonts: ['Noto Serif Armenian', 'Cormorant Garamond', 'Inter', 'Mardoto'],
  blocks: [BlockType.HERO, BlockType.STORY, BlockType.COUNTDOWN, BlockType.VENUE, BlockType.MAP,
    BlockType.TIMELINE, BlockType.DRESS_CODE, BlockType.NOTES, BlockType.GALLERY, BlockType.RSVP, BlockType.CONTACT],
  variants: ['full-bleed', 'split', 'stacked'],
  themeKeys: ['headingFont', 'bodyFont', 'palette', 'colors'],
};
