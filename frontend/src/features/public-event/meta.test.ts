import { describe, expect, it } from 'vitest';

import { publicEventMeta } from './meta';
import { readPublicEvent } from './read';
import { publicEventWire } from './test-data';

const ORIGIN = 'https://aveline.test';

function tag(descriptors: ReturnType<typeof publicEventMeta>, key: string, value: string) {
  return descriptors.filter((descriptor) => (descriptor as Record<string, unknown>)[key] === value);
}

function contents(descriptors: ReturnType<typeof publicEventMeta>): unknown[] {
  return descriptors.map((descriptor) => (descriptor as Record<string, unknown>).content);
}

describe("a public event's head", () => {
  it("uses the response's metadata verbatim, robots included", () => {
    const event = readPublicEvent(
      publicEventWire({
        metadata: {
          title: 'Share title',
          description: 'Share description',
          image: {
            id: 'm1',
            url: '/files/m1.jpg',
            width: 1200,
            height: 630,
            altText: 'The garden',
            variants: [],
          },
          locale: 'en',
          alternateLocales: ['hy', 'ru'],
          canonicalPath: '/events/autumn-jazz-night',
          robots: 'index,follow',
        },
      }),
    );
    const head = publicEventMeta(event, ORIGIN);
    expect(head).toContainEqual({ title: 'Share title' });
    expect(head).toContainEqual({ name: 'robots', content: 'index,follow' });
    expect(head).toContainEqual({ name: 'description', content: 'Share description' });
    expect(head).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'https://aveline.test/events/autumn-jazz-night',
    });
    expect(head).toContainEqual({
      property: 'og:image',
      content: 'https://aveline.test/files/m1.jpg',
    });
    expect(head).toContainEqual({ property: 'og:image:alt', content: 'The garden' });
    expect(contents(tag(head, 'property', 'og:locale:alternate'))).toEqual(['hy', 'ru']);
  });

  it('keeps an absolute image address as it came', () => {
    const event = readPublicEvent(
      publicEventWire({
        metadata: {
          ...(publicEventWire().metadata as object),
          image: { id: 'm', url: 'https://media.test/m.jpg' },
        },
      }),
    );
    expect(publicEventMeta(event, ORIGIN)).toContainEqual({
      property: 'og:image',
      content: 'https://media.test/m.jpg',
    });
  });

  it('falls back to the headline, and keeps a private event out of indexes', () => {
    const event = readPublicEvent(publicEventWire({ metadata: { canonicalPath: '/events/x' } }));
    const head = publicEventMeta(event, ORIGIN);
    expect(head).toContainEqual({ title: 'Autumn Jazz Night' });
    expect(head).toContainEqual({ name: 'robots', content: 'noindex,nofollow' });
    expect(tag(head, 'property', 'og:image')).toEqual([]);
  });

  it('says nothing about an event it could not open', () => {
    expect(publicEventMeta(undefined, ORIGIN)).toEqual([
      { title: 'Aveline' },
      { name: 'robots', content: 'noindex,nofollow' },
    ]);
  });
});
