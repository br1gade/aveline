import { describe, expect, it } from 'vitest';

import { withFirstPage, withNextPage, withShared, withoutPhoto } from './list';
import { photo } from './test-data';

const at = (minutes: number) => new Date(Date.UTC(2027, 5, 12, 16, minutes)).toISOString();

describe('the guest’s list as it is read again', () => {
  it('puts photos just shared first, and updates ones it holds where they stand', () => {
    const held = [photo({ id: 'b', processing: 'QUEUED' }), photo({ id: 'a' })];
    const shared = [photo({ id: 'c' }), photo({ id: 'b', processing: 'READY' })];
    expect(withShared(held, shared).map((item) => `${item.id}:${item.processing}`)).toEqual([
      'c:READY',
      'b:READY',
      'a:READY',
    ]);
  });

  it('adds a later page’s photos after the ones it holds, once each', () => {
    const held = [photo({ id: 'b' })];
    const page = { photos: [photo({ id: 'b' }), photo({ id: 'a' })], nextCursor: null };
    expect(withNextPage(held, page).map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('takes a whole first page as the list, so a photo withdrawn meanwhile goes', () => {
    const held = [photo({ id: 'b', createdAt: at(2) }), photo({ id: 'gone', createdAt: at(1) })];
    const page = { photos: [photo({ id: 'b', createdAt: at(2) })], nextCursor: null };
    expect(withFirstPage(held, page).map((item) => item.id)).toEqual(['b']);
  });

  it('keeps the older photos a later page brought, below a first page that has more after it', () => {
    const held = [
      photo({ id: 'new', createdAt: at(5) }),
      photo({ id: 'withdrawn', createdAt: at(4) }),
      photo({ id: 'edge', createdAt: at(3) }),
      photo({ id: 'older', createdAt: at(1) }),
    ];
    const page = {
      photos: [
        photo({ id: 'newest', createdAt: at(6) }),
        photo({ id: 'new', createdAt: at(5) }),
        photo({ id: 'edge', createdAt: at(3) }),
      ],
      nextCursor: 'edge',
    };
    expect(withFirstPage(held, page).map((item) => item.id)).toEqual([
      'newest',
      'new',
      'edge',
      'older',
    ]);
  });

  it('drops a removed photo', () => {
    const held = [photo({ id: 'a' }), photo({ id: 'b' })];
    expect(withoutPhoto(held, 'a').map((item) => item.id)).toEqual(['b']);
  });
});
