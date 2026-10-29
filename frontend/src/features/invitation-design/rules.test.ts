import { describe, expect, it } from 'vitest';

import { languagesWithoutCopy } from './languages';
import { canShowMedia, uploadable, uploadProblem, UPLOAD_LIMIT_BYTES } from './media-rules';
import { refusedProperties } from './server-errors';
import { switchEffects } from './template-switch';
import type { DesignBlock, DesignTemplate } from './types';
import { ApiError } from '@/api/errors';

function section(type: string, fields: Partial<DesignBlock> = {}): DesignBlock {
  return {
    type,
    enabled: true,
    variant: null,
    content: {},
    settings: {},
    assetIds: [],
    media: [],
    ...fields,
  };
}

describe('languages', () => {
  const block = section('STORY', { content: { hy: { body: 'Բարև' }, fr: { body: 'Bonjour' } } });

  it('names the event’s languages with no copy, whose guests read the default language’s', () => {
    expect(languagesWithoutCopy(block, ['hy', 'ru', 'en'])).toEqual(['ru', 'en']);
  });
});

describe('switchEffects', () => {
  const target: DesignTemplate = {
    key: 'minimal',
    name: 'Minimal',
    allowedFonts: ['Inter'],
    palettes: [{ name: 'paper', colors: ['#ffffff'] }],
    supportedBlocks: ['HERO', 'VENUE', 'RSVP', 'CONTACT'],
    blockVariants: { HERO: ['split'], VENUE: ['stacked'] },
    defaultTheme: { bodyFont: 'Inter', palette: 'paper' },
  };

  it('lists the shown sections it hides, the layouts it resets and the sections it lacks', () => {
    const blocks = [
      section('HERO', { variant: 'full-bleed' }),
      section('STORY'),
      section('GALLERY', { enabled: false }),
      section('VENUE', { variant: 'stacked' }),
      section('RSVP', { variant: 'split' }),
    ];
    expect(switchEffects(blocks, target)).toEqual({
      hidden: ['STORY'],
      layoutsReset: ['HERO', 'RSVP'],
      missing: ['CONTACT'],
    });
  });
});

describe('media rules', () => {
  const file = (type: string, size = 1000) => ({ type, size });

  it('takes the backend’s types up to 10 MB, and nothing else', () => {
    expect(uploadProblem(file('image/jpeg'))).toBeNull();
    expect(uploadProblem(file('audio/mpeg'))).toBeNull();
    expect(uploadProblem(file('image/svg+xml'))).toBe('type');
    expect(uploadProblem(file(''))).toBe('type');
    expect(uploadProblem(file('image/png', UPLOAD_LIMIT_BYTES + 1))).toBe('size');
    expect(uploadProblem(file('image/png', UPLOAD_LIMIT_BYTES))).toBeNull();
  });

  it('labels an M4A the browser calls audio/x-m4a as the audio/mp4 it is (FR-45)', () => {
    expect(uploadProblem(file('audio/x-m4a'))).toBeNull();
    const m4a = new File(['x'], 'song.m4a', { type: 'audio/x-m4a' });
    expect(uploadable(m4a).type).toBe('audio/mp4');
    const photo = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    expect(uploadable(photo)).toBe(photo);
  });

  it('offers images to picture blocks and audio to the music', () => {
    expect(canShowMedia('images', 'LOGO')).toBe(true);
    expect(canShowMedia('image', 'AUDIO')).toBe(false);
    expect(canShowMedia('audio', 'AUDIO')).toBe(true);
    expect(canShowMedia('audio', 'PHOTO')).toBe(false);
    expect(canShowMedia('none', 'PHOTO')).toBe(false);
  });
});

describe('refusedProperties', () => {
  it('reads the property each message starts with, the theme’s every one at once', () => {
    const error = new ApiError({
      status: 400,
      messages: [
        'bodyFont: "Comic Sans" is not one of this template\'s fonts (Inter, Mardoto)',
        'palette: "neon" is not one of this template\'s palettes (paper, ink)',
        'type must be one of the following values: TEXT, LONG_TEXT',
        'Template does not support: STORY',
      ],
    });
    expect(refusedProperties(error)).toEqual(['bodyFont', 'palette', 'type']);
  });

  it('reads the fields the feedback names too, once each', () => {
    const error = new ApiError({
      status: 400,
      messages: ['altText: en is longer than 300 characters'],
      feedback: {
        code: 'VALIDATION_FAILED',
        action: 'EDIT',
        userMessage: 'Check the highlighted fields',
        details: [
          { field: 'altText', code: 'INVALID', userMessage: '…' },
          { field: null, code: 'INVALID', userMessage: '…' },
        ],
      },
    });
    expect(refusedProperties(error)).toEqual(['altText']);
  });

  it('reads nothing from a refusal that is not a 400', () => {
    expect(refusedProperties(new ApiError({ status: 409, messages: ['palette: x'] }))).toEqual([]);
    expect(refusedProperties(new Error('palette: x'))).toEqual([]);
  });
});
