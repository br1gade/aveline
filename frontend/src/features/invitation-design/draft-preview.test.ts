import { describe, expect, it } from 'vitest';

import { BLOCK_EDITING, type Invitation } from '@/features/invitation-renderer';

import { draftInvitation, type DraftSection } from './draft-preview';
import { sectionFormValues, type SectionFormValues } from './form-model';
import { readDesign, readLibrary } from './read';
import { designWire, libraryWire, previewWire } from './test-data';
import type { DesignBlock } from './types';

const design = readDesign(designWire());
const library = readLibrary(libraryWire());
const ORDER = design.blocks.map(({ type }) => type);
const saved = (locale = 'en') => previewWire(locale) as Invitation;

function blockOf(type: string, more: Partial<DesignBlock> = {}): DesignBlock {
  const found = design.blocks.find((block) => block.type === type);
  return {
    type,
    enabled: true,
    variant: null,
    content: {},
    settings: {},
    assetIds: [],
    media: [],
    ...found,
    ...more,
  };
}

/** A section's form as read, with the changes typed into it. */
function draft(
  block: DesignBlock,
  change: (values: SectionFormValues) => SectionFormValues = (values) => values,
  more: Partial<DraftSection> = {},
): DraftSection {
  const editing = BLOCK_EDITING[block.type as keyof typeof BLOCK_EDITING];
  const values = change(sectionFormValues(block, editing, design.event.locales));
  return {
    block,
    editing,
    values,
    layouts: null,
    library,
    order: ORDER,
    defaultLocale: 'hy',
    ...more,
  };
}

const typed =
  (locale: string, fields: Record<string, string>) =>
  (values: SectionFormValues): SectionFormValues => ({
    ...values,
    copy: {
      ...values.copy,
      [locale]: {
        fields: { ...values.copy[locale]?.fields, ...fields },
        items: values.copy[locale]?.items ?? [],
      },
    },
  });

const blockNamed = (invitation: Invitation, type: string) =>
  invitation.blocks.find((block) => block.type === type);

describe('the draft preview: the section’s form over the saved page (PD-153)', () => {
  it('shows the words typed in the preview’s language', () => {
    const page = draftInvitation(
      saved('en'),
      draft(blockOf('HERO'), typed('en', { title: 'Anna and Davit' })),
    );
    expect(blockNamed(page, 'HERO')?.content).toEqual({ title: 'Anna and Davit' });
  });

  it('falls back to the event’s own language for a language with no words, as the backend does', () => {
    const page = draftInvitation(
      saved('en'),
      draft(blockOf('HERO', { content: { hy: { title: 'Աննա' } } })),
    );
    expect(blockNamed(page, 'HERO')?.content).toEqual({ title: 'Աննա' });
  });

  it('keeps the stored fields the form doesn’t edit, as saving does', () => {
    const page = draftInvitation(
      saved('hy'),
      draft(blockOf('HERO'), typed('hy', { title: 'Նոր' })),
    );
    expect(blockNamed(page, 'HERO')?.content).toEqual({ title: 'Նոր', kicker: 'kept' });
  });

  it('shows the layout chosen, and the template’s own for one it doesn’t offer', () => {
    const chosen = (variant: string, layouts: readonly string[] | null) =>
      blockNamed(
        draftInvitation(
          saved(),
          draft(blockOf('HERO'), (values) => ({ ...values, variant }), { layouts }),
        ),
        'HERO',
      )?.variant;
    expect(chosen('', ['split'])).toBeNull();
    expect(chosen('split', ['split', 'full-bleed'])).toBe('split');
    expect(chosen('gone', ['split'])).toBeNull();
    expect(chosen('split', null)).toBe('split');
  });

  it('shows the media chosen, in order, with alt text in the language or the event’s own', () => {
    const page = draftInvitation(
      saved('en'),
      draft(blockOf('HERO'), (values) => ({ ...values, assetIds: ['m2', 'm1'] })),
    );
    expect(blockNamed(page, 'HERO')?.media.map(({ id, altText }) => [id, altText])).toEqual([
      ['m2', 'The garden'],
      ['m1', 'Աննան և Դավիթը'],
    ]);
    expect(page.coverUrl).toBe('https://media.example.com/garden.jpg');
  });

  it('keeps the template’s own media when the section had none and still has none', () => {
    const withDefault = saved();
    const hero = withDefault.blocks[0];
    if (hero)
      hero.media = [
        { id: 'd1', url: 'https://media.example.com/d.jpg', kind: 'PHOTO', altText: null },
      ];
    const page = draftInvitation(withDefault, draft(blockOf('HERO')));
    expect(blockNamed(page, 'HERO')?.media.map(({ id }) => id)).toEqual(['d1']);
  });

  it('puts the swatches chosen over the stored settings', () => {
    const block = blockOf('DRESS_CODE', { settings: { palette: ['#000000'], kept: true } });
    const page = draftInvitation(
      saved(),
      draft(block, (values) => ({ ...values, colours: ['#AABBCC'] })),
    );
    expect(blockNamed(page, 'DRESS_CODE')?.settings).toEqual({ kept: true, palette: ['#aabbcc'] });
  });

  it('plays the music chosen', () => {
    const page = draftInvitation(
      saved(),
      draft(blockOf('MUSIC'), (values) => ({ ...values, assetIds: ['m2'] })),
    );
    expect(page.musicUrl).toBe('https://media.example.com/garden.jpg');
  });

  it('puts a section not on the saved page where the editor has it, and leaves the rest as they were', () => {
    const before = saved('hy');
    const page = draftInvitation(before, draft(blockOf('STORY')));
    expect(page.blocks.map(({ type }) => type)).toEqual(['HERO', 'STORY', 'RSVP']);
    expect(blockNamed(page, 'STORY')).toMatchObject({
      data: null,
      content: { body: 'Ուրախ կլինենք' },
    });
    expect(page.blocks[0]).toBe(before.blocks[0]);
    expect(page.blocks[2]).toBe(before.blocks[1]);
  });

  it('never sorts the sections, whatever their order numbers say', () => {
    const before = saved();
    before.blocks.reverse();
    const page = draftInvitation(before, draft(blockOf('HERO'), typed('en', { title: 'X' })));
    expect(page.blocks.map(({ type }) => type)).toEqual(['RSVP', 'HERO']);
  });
});
