import { describe, expect, it } from 'vitest';

import { imageSource } from './image-source';

describe('imageSource', () => {
  it('offers the smaller copies and the original, narrowest first', () => {
    expect(
      imageSource({
        id: 'm1',
        url: 'https://media.example.com/original.jpg',
        kind: 'PHOTO',
        altText: null,
        width: 3000,
        height: 4000,
        variants: [
          { width: 960, height: 1280, url: 'https://media.example.com/960.webp' },
          { width: 480, height: 640, url: 'https://media.example.com/480.webp' },
        ],
      }),
    ).toEqual({
      src: 'https://media.example.com/original.jpg',
      srcSet:
        'https://media.example.com/480.webp 480w, https://media.example.com/960.webp 960w, https://media.example.com/original.jpg 3000w',
      width: 3000,
      height: 4000,
    });
  });

  it('falls back to the original alone until the copies exist', () => {
    expect(
      imageSource({
        id: 'm1',
        url: 'https://media.example.com/o.jpg',
        kind: 'PHOTO',
        altText: null,
      }),
    ).toEqual({ src: 'https://media.example.com/o.jpg' });
  });
});
