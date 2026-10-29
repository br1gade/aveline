import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { block, invitationFixture, VENUES } from '../fixtures';
import { InvitationPage } from '../invitation-page';
import { BLOCK_TYPES, type BlockMedia, type BlockType, type InvitationBlock } from '../types';
import { BLOCK_EDITING } from './fields';

class StubObserver {
  observe() {}
  disconnect() {}
}

const PHOTO: BlockMedia = {
  id: 'photo',
  url: 'https://media.example.com/a.jpg',
  kind: 'PHOTO',
  altText: null,
};

/** What each block needs, besides its words, before it renders anything at all. */
const NEEDS: Partial<Record<BlockType, Partial<InvitationBlock>>> = {
  COUNTDOWN: { data: { target: '2027-06-12T12:00:00.000Z', timezone: 'Asia/Yerevan' } },
  VENUE: { data: VENUES },
  MAP: { data: VENUES },
  TIMELINE: { data: [{ label: 'Dinner', occursAt: '2027-06-12T14:00:00.000Z', venueId: null }] },
  GALLERY: { media: [PHOTO] },
  MUSIC: { variant: 'card' },
};

/** Every field the table lists, filled with a value that names it. */
function filled(type: BlockType): Record<string, unknown> {
  const editing = BLOCK_EDITING[type];
  const content: Record<string, unknown> = {};
  for (const field of editing.fields) {
    content[field.name] =
      field.kind === 'url' ? `https://chat.example.com/${type}` : `${type}-${field.name}`;
  }
  if (editing.items.length > 0) {
    content.items = [
      Object.fromEntries(editing.items.map((item) => [item.name, `${type}-item-${item.name}`])),
    ];
  }
  return content;
}

function renderBlock(type: BlockType) {
  // A HERO first, so the block under test is never the page's cover unless it is the HERO.
  const blocks = type === 'HERO' ? [] : [block('HERO')];
  blocks.push(block(type, { content: filled(type), ...NEEDS[type] }));
  const invitation = invitationFixture({ blocks, musicUrl: 'https://media.example.com/song.mp3' });
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <InvitationPage invitation={invitation} />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', StubObserver);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-04-30T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BLOCK_EDITING', () => {
  it('describes every block type the renderer knows', () => {
    expect(Object.keys(BLOCK_EDITING).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it.each(BLOCK_TYPES.filter((type) => BLOCK_EDITING[type].fields.length > 0))(
    'lists only fields the %s block shows',
    (type) => {
      renderBlock(type);
      for (const field of BLOCK_EDITING[type].fields) {
        if (field.kind === 'url') {
          expect(screen.getByRole('link', { name: `${type}-label` })).toHaveAttribute(
            'href',
            `https://chat.example.com/${type}`,
          );
        } else {
          expect(screen.getAllByText(`${type}-${field.name}`).length).toBeGreaterThan(0);
        }
      }
    },
  );

  it('lists the fields of each note', () => {
    renderBlock('NOTES');
    for (const item of BLOCK_EDITING.NOTES.items) {
      expect(screen.getByText(`NOTES-item-${item.name}`)).toBeInTheDocument();
    }
  });
});
