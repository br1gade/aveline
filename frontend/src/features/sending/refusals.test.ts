import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { refusalOf } from './refusals';

function refused(status: number, code: string, message = 'No') {
  return new ApiError({
    status,
    messages: [message],
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('publishing refused while a template’s artwork is prepared', () => {
  it('says so, with nothing out of date and no sentence in English', () => {
    expect(
      refusalOf(refused(409, 'TEMPLATE_ASSET_NOT_READY', 'Private design artwork must finish')),
    ).toMatchObject({ messages: [], isStale: false, isArtworkPreparing: true });
  });

  it('leaves any other conflict as it was', () => {
    const refusal = refusalOf(refused(409, 'CONFLICT'));
    expect(refusal.isStale).toBe(true);
    expect(refusal.isArtworkPreparing).toBeUndefined();
  });
});
