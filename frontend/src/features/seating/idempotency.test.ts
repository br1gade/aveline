import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { createRetryKey } from './idempotency';

describe('the key that makes a start safe to send again', () => {
  const keys = () => {
    let made = 0;
    return createRetryKey(() => `key-${++made}`);
  };

  it('is new for each press that got an answer', () => {
    const retry = keys();
    expect(retry.next()).toBe('key-1');
    retry.settle(null);
    expect(retry.next()).toBe('key-2');
    retry.settle(new ApiError({ status: 409, messages: [] }));
    expect(retry.next()).toBe('key-3');
  });

  it('is sent again after a press that got no answer, so one start is never queued twice', () => {
    const retry = keys();
    expect(retry.next()).toBe('key-1');
    retry.settle(new ApiError({ status: 0, messages: [] }));
    expect(retry.next()).toBe('key-1');
    retry.settle(new Error('offline'));
    expect(retry.next()).toBe('key-1');
    retry.settle(null);
    expect(retry.next()).toBe('key-2');
  });

  it('makes a version 4 UUID by default', () => {
    expect(createRetryKey().next()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
