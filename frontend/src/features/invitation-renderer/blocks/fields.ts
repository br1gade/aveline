import type { BlockType } from '../types';

/**
 * What each block reads from its `content`, `settings` and media, for the host's designer to write.
 *
 * The backend stores block content as free JSON per language (design R-30, FR-43), so the editor
 * and this renderer must agree on the names; this table is the one place they do. The readers in
 * `schemas.ts` read exactly these fields, and `fields.test.tsx` renders each one to prove it.
 */

/** How an editor asks for a field: one line, paragraphs, a web link, or a phone number. */
export type ContentFieldKind = 'line' | 'text' | 'url' | 'phone';

export interface ContentField {
  name: string;
  kind: ContentFieldKind;
}

/** Which media a block shows: none, one image (the first), images in order, or one audio file. */
export type BlockMediaUse = 'none' | 'image' | 'images' | 'audio';

export interface BlockEditing {
  /** In the order an editor shows them. */
  fields: readonly ContentField[];
  /** NOTES only: a list of items, each with these fields. */
  items: readonly ContentField[];
  /** DRESS_CODE only: suggested colours, as six-digit hex in `settings.palette`. */
  hasSwatches: boolean;
  media: BlockMediaUse;
  /** Facts the backend fills in from the event itself; no content changes them. */
  data: 'venues' | 'timeline' | 'countdown' | null;
}

const line = (name: string): ContentField => ({ name, kind: 'line' });
const paragraphs = (name: string): ContentField => ({ name, kind: 'text' });

function editing(fields: readonly ContentField[], more: Partial<BlockEditing> = {}): BlockEditing {
  return { fields, items: [], hasSwatches: false, media: 'none', data: null, ...more };
}

export const BLOCK_EDITING: Readonly<Record<BlockType, BlockEditing>> = {
  // An empty title falls back to the event's hosts.
  HERO: editing([line('title'), line('subtitle')], { media: 'image' }),
  // The photo shows in the `with-photo` layout.
  STORY: editing([line('title'), paragraphs('body')], { media: 'image' }),
  COUNTDOWN: editing([line('title')], { data: 'countdown' }),
  // The title shows in the `card` layout; the audio is the page's music (C-19).
  MUSIC: editing([line('title')], { media: 'audio' }),
  VENUE: editing([line('title')], { data: 'venues' }),
  MAP: editing([line('title')], { data: 'venues' }),
  TIMELINE: editing([line('title')], { data: 'timeline' }),
  DRESS_CODE: editing([line('title'), paragraphs('body')], { hasSwatches: true }),
  NOTES: editing([line('title')], { items: [line('title'), paragraphs('body')] }),
  GALLERY: editing([line('title')], { media: 'images' }),
  RSVP: editing([line('title'), paragraphs('body')]),
  // A SIGNATURE or LOGO image first, otherwise a photo.
  SIGNATURE: editing([line('closing')], { media: 'image' }),
  // Shown only with a web link; `label` is the button's words.
  CHAT: editing([line('title'), paragraphs('body'), { name: 'url', kind: 'url' }, line('label')]),
  CONTACT: editing([line('title'), line('organizer'), { name: 'phone', kind: 'phone' }]),
};
