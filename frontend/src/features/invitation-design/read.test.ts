import { describe, expect, it } from 'vitest';

import { readDesign, readLibrary, readTemplates } from './read';
import type { DesignWire } from './types';

function designWire(fields: Partial<DesignWire> = {}): DesignWire {
  return {
    slug: 'anna-davit-3f8a1c20',
    status: 'DRAFT',
    event: {
      id: 'event-1',
      title: 'Anna & Davit',
      locales: ['hy', 'en'],
      defaultLocale: 'hy',
      timezone: 'Asia/Yerevan',
    },
    template: {
      key: 'classic',
      name: 'Classic',
      allowedFonts: ['Noto Serif Armenian'],
      palettes: [{ name: 'sage', colors: ['#EDF1EA', 7] }, { colors: [] }],
      supportedBlocks: ['HERO', 'RSVP'],
    },
    theme: { palette: 'sage', font: 'old name' },
    effectiveTheme: { bodyFont: 'Noto Serif Armenian', palette: 'sage' },
    rsvpFields: { songRequest: { isEnabled: false, options: null } },
    blocks: [],
    questions: [],
    publishBlockers: [],
    ...fields,
  };
}

describe('readDesign', () => {
  it('keeps the blocks in the order given, unknown types and switched-off ones included', () => {
    const design = readDesign(
      designWire({
        blocks: [
          {
            type: 'RSVP',
            enabled: false,
            variant: null,
            content: null,
            settings: null,
            assetIds: [],
          },
          {
            type: 'FIREWORKS',
            enabled: true,
            variant: 'big',
            content: {},
            settings: {},
            assetIds: [],
          },
          { type: 'HERO', enabled: true, variant: null, content: {}, settings: {}, assetIds: [] },
        ],
      }),
    );
    expect(design.blocks.map((block) => block.type)).toEqual(['RSVP', 'FIREWORKS', 'HERO']);
    expect(design.blocks[0]).toMatchObject({ enabled: false, content: {}, settings: {} });
  });

  it('keeps every language of the copy, unknown fields included, and drops what is not copy', () => {
    const design = readDesign(
      designWire({
        blocks: [
          {
            type: 'HERO',
            enabled: true,
            variant: null,
            content: { hy: { title: 'Ա', kicker: 'x' }, en: 'not an object', fr: { title: 'B' } },
            settings: {},
            assetIds: ['a'],
            media: [
              {
                id: 'a',
                url: 'https://media.example.com/a.jpg',
                kind: 'PHOTO',
                altText: { en: 'Anna', ru: 3 },
                variants: [
                  { width: 480, height: 600, url: 'https://media.example.com/a-480.webp' },
                  {},
                ],
              },
            ],
          },
        ],
      }),
    );
    const [hero] = design.blocks;
    expect(hero?.content).toEqual({ hy: { title: 'Ա', kicker: 'x' }, fr: { title: 'B' } });
    expect(hero?.media[0]).toEqual({
      id: 'a',
      url: 'https://media.example.com/a.jpg',
      kind: 'PHOTO',
      altText: { en: 'Anna' },
      width: null,
      height: null,
      variants: [{ width: 480, height: 600, url: 'https://media.example.com/a-480.webp' }],
    });
  });

  it('reads the theme by its documented names, the palettes that have one, and every built-in question', () => {
    const design = readDesign(designWire());
    expect(design.theme).toEqual({ palette: 'sage' });
    expect(design.template.palettes).toEqual([{ name: 'sage', colors: ['#EDF1EA'] }]);
    expect(design.rsvpFields.songRequest).toEqual({ isEnabled: false, options: null });
    expect(design.rsvpFields.dietary).toEqual({ isEnabled: true, options: null });
  });

  it('reads the questions in the host’s order with their answers counted', () => {
    const design = readDesign(
      designWire({
        questions: [
          {
            id: 'q2',
            type: 'SINGLE_CHOICE',
            required: true,
            prompt: { en: 'How?' },
            options: { en: ['Car', 4, 'Shuttle'] },
            answerCount: 12,
          },
          { id: 'q1', type: 'BOOLEAN', required: false, prompt: { en: 'Kids?' }, options: [] },
        ],
      }),
    );
    expect(design.questions).toEqual([
      {
        id: 'q2',
        type: 'SINGLE_CHOICE',
        required: true,
        prompt: { en: 'How?' },
        options: { en: ['Car', 'Shuttle'] },
        answerCount: 12,
      },
      {
        id: 'q1',
        type: 'BOOLEAN',
        required: false,
        prompt: { en: 'Kids?' },
        options: {},
        answerCount: 0,
      },
    ]);
  });
});

describe('readTemplates', () => {
  it('reads each template’s layouts and default look', () => {
    const [template] = readTemplates([
      {
        key: 'minimal',
        name: 'Minimal',
        allowedFonts: ['Inter', 'Mardoto'],
        palettes: [{ name: 'paper', colors: ['#FFFFFF'] }],
        supportedBlocks: ['HERO'],
        blockVariants: { HERO: ['split', 3], RSVP: 'stacked' },
        defaultTheme: { bodyFont: 'Inter', palette: 'paper' },
      },
    ]);
    expect(template?.blockVariants).toEqual({ HERO: ['split'], RSVP: [] });
    expect(template?.defaultTheme).toEqual({ bodyFont: 'Inter', palette: 'paper' });
  });
});

describe('readLibrary', () => {
  it('reads what each upload is and what shows it', () => {
    const [item] = readLibrary([
      {
        id: 'a',
        url: 'https://media.example.com/a.jpg',
        kind: 'LOGO',
        mimeType: 'image/png',
        sizeBytes: 70,
        altText: {},
        createdAt: '2026-10-29T10:00:00.000Z',
        usedBy: ['SIGNATURE'],
        listingUses: [],
      },
    ]);
    expect(item).toMatchObject({
      kind: 'LOGO',
      sizeBytes: 70,
      usedBy: ['SIGNATURE'],
      listingUses: [],
    });
  });
});
