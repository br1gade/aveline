import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { publishBlockers, typeRefusal } from './refusals';

describe("the announcement's publish blockers, by their exact words until FR-69", () => {
  it('words each blocker the backend has, and keeps any other as it came', () => {
    const error = new ApiError({
      status: 400,
      messages: [
        'This event is private. Set its visibility to PUBLIC or UNLISTED first, deliberately',
        'headline: give the listing a headline in at least one language',
        'This event has already started',
        'This event is archived. Unarchive it first',
        'Something new',
      ],
    });
    expect(publishBlockers(error)).toEqual([
      { kind: 'private' },
      { kind: 'headline' },
      { kind: 'started' },
      { kind: 'archived' },
      { kind: 'other', sentence: 'Something new' },
    ]);
  });

  it('asks for the announcement to be written first when there is none', () => {
    expect(
      publishBlockers(
        new ApiError({ status: 404, messages: ['Create the listing before publishing it'] }),
      ),
    ).toEqual([{ kind: 'noListing' }]);
  });
});

describe("a ticket type's refusals", () => {
  it.each([
    [
      409,
      '12 sold and 2 held against this type. Set isActive to false to stop selling it instead.',
      'inUse',
    ],
    [
      409,
      'This type has checkout history or someone started buying it; deactivate it instead',
      'inUse',
    ],
    [
      409,
      'More tickets were sold or held while you were editing; capacity cannot go that low now',
      'capacityTaken',
    ],
    [404, 'No such ticket type on this event', 'gone'],
    [403, 'Forbidden', 'forbidden'],
    [400, 'quantityTotal: 14 are already sold or held, so capacity cannot go below that', 'fields'],
  ])('%i %j reads as %s', (status, message, kind) => {
    expect(typeRefusal(new ApiError({ status, messages: [message] })).kind).toBe(kind);
  });

  it('puts a refused field on its own field', () => {
    expect(
      typeRefusal(
        new ApiError({
          status: 400,
          messages: [
            'maxPerOrder: cannot be lower than minPerOrder',
            'salesEndAt: sales must end after they start',
          ],
        }),
      ),
    ).toEqual({ kind: 'fields', paths: ['maxPerOrder', 'salesEndDate'] });
  });
});
