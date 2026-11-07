import { describe, expect, it } from 'vitest';

import { block, VENUES } from './fixtures';
import {
  heroContent,
  notesContent,
  paragraphs,
  swatchColours,
  telephoneHref,
  timelineEntries,
  venues,
} from './schemas';
import { invitationPalette } from './theme';

describe('block content', () => {
  it('keeps a well-formed title and drops what is blank or of the wrong type', () => {
    expect(
      heroContent(block('HERO', { content: { title: ' Anna & Davit ', subtitle: 42 } })),
    ).toEqual({
      title: 'Anna & Davit',
      subtitle: undefined,
    });
    expect(heroContent(block('HERO', { content: { title: '   ' } })).title).toBeUndefined();
  });

  it.each([null, 'text', [], 7])('reads content that is not an object (%j) as empty', (content) => {
    expect(heroContent(block('HERO', { content }))).toEqual({
      title: undefined,
      subtitle: undefined,
    });
  });

  it('keeps notes that say something and drops malformed ones', () => {
    const content = {
      items: [
        { title: 'Flowers', body: 'A card instead.' },
        { title: '' },
        'nonsense',
        { body: 'Only a body' },
      ],
    };
    expect(notesContent(block('NOTES', { content })).items).toEqual([
      { title: 'Flowers', body: 'A card instead.' },
      { title: undefined, body: 'Only a body' },
    ]);
  });

  it('splits paragraphs on blank lines only', () => {
    expect(paragraphs('One\nstill one\n\nTwo\n \nThree')).toEqual([
      'One\nstill one',
      'Two',
      'Three',
    ]);
    expect(paragraphs(undefined)).toEqual([]);
  });
});

describe('swatchColours (PD-24)', () => {
  it('keeps six-digit hex values only', () => {
    const settings = {
      palette: ['#2E2A26', '#abc', 'red', 'rgb(0,0,0)', 12, '#7a8b74', '#7A8B74;x'],
    };
    expect(swatchColours(block('DRESS_CODE', { settings }))).toEqual(['#2E2A26', '#7a8b74']);
  });

  it.each([null, { palette: 'nope' }, []])('returns none for settings %j', (settings) => {
    expect(swatchColours(block('DRESS_CODE', { settings }))).toEqual([]);
  });
});

describe('event data', () => {
  it('reads venues and skips a malformed one', () => {
    expect(venues(block('VENUE', { data: [...VENUES, { name: 'No role' }] }))).toHaveLength(2);
    expect(venues(block('VENUE', { data: null }))).toEqual([]);
  });

  it('leaves out a timeline entry with no label in this language', () => {
    const data = [
      { label: 'Ceremony', occursAt: '2027-06-12T10:00:00.000Z', venueId: null },
      { label: null, occursAt: '2027-06-12T11:00:00.000Z', venueId: null },
    ];
    expect(timelineEntries(block('TIMELINE', { data })).map((entry) => entry.label)).toEqual([
      'Ceremony',
    ]);
  });
});

describe('links from host content', () => {
  it.each([
    ['+374 00 000000', 'tel:+37400000000'],
    ['(010) 12-34-56', 'tel:010123456'],
    ['+1 +2 3', 'tel:+123'],
    ['call us', undefined],
  ])('telephoneHref(%j) is %j', (input, expected) => {
    expect(telephoneHref(input)).toBe(expected);
  });
});

describe('invitationPalette (PD-21 stand-in)', () => {
  it('holds bordeaux', () => {
    expect(invitationPalette({ palette: 'bordeaux' })).toEqual({
      name: 'bordeaux',
      coverTheme: 'bordeaux',
      letterTheme: 'ivory',
    });
  });

  it('renders any other palette, such as the seed’s ivory-gold, in bordeaux and says so', () => {
    expect(invitationPalette({ palette: 'ivory-gold', colors: ['#fff'] })).toMatchObject({
      name: 'bordeaux',
      replaced: 'ivory-gold',
    });
  });

  it.each([{}, { palette: 3 }, { palette: 'constructor' }])('falls back for %j', (theme) => {
    expect(invitationPalette(theme).name).toBe('bordeaux');
  });
});
