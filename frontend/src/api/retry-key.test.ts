import { describe, expect, it } from 'vitest';

import { ApiError } from './errors';
import { createRetryKey, type PendingKey } from './retry-key';

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

  it('is sent again after a server failure, which may have queued the work before it failed', () => {
    const retry = keys();
    expect(retry.next()).toBe('key-1');
    retry.settle(new ApiError({ status: 502, messages: [] }));
    expect(retry.next()).toBe('key-1');
    retry.settle(new ApiError({ status: 500, messages: [] }));
    expect(retry.next()).toBe('key-1');
    retry.settle(new ApiError({ status: 429, messages: [] }));
    expect(retry.next()).toBe('key-2');
  });

  it('makes a version 4 UUID by default', () => {
    expect(createRetryKey().next()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('is sent again only for the same intent: other choices are another request', () => {
    const retry = keys();
    expect(retry.next('guest list, PDF')).toBe('key-1');
    retry.settle(new ApiError({ status: 0, messages: [] }));
    expect(retry.next('guest list, CSV')).toBe('key-2');
    retry.settle(new ApiError({ status: 0, messages: [] }));
    expect(retry.next('guest list, CSV')).toBe('key-2');
  });

  it('says whether the next press for an intent would send a key already sent', () => {
    const retry = keys();
    expect(retry.isPending('guest list, PDF')).toBe(false);
    retry.next('guest list, PDF');
    retry.settle(new ApiError({ status: 0, messages: [] }));
    expect(retry.isPending('guest list, PDF')).toBe(true);
    expect(retry.isPending('guest list, CSV')).toBe(false);
    retry.next('guest list, PDF');
    retry.settle(null);
    expect(retry.isPending('guest list, PDF')).toBe(false);
  });
});

describe('the key kept across a reload (design PD-152)', () => {
  /** A tab's storage: what one page wrote, the next page reads. */
  function tab() {
    let kept: PendingKey | null = null;
    return { read: () => kept, write: (pending: PendingKey | null) => void (kept = pending) };
  }
  let made = 0;
  const make = () => `key-${++made}`;

  it('sends the key the page before had pending for the same intent', () => {
    const store = tab();
    const before = createRetryKey(make, store);
    const key = before.next('order a');
    before.settle(new ApiError({ status: 0, messages: [] }));
    expect(createRetryKey(make, store).next('order a')).toBe(key);
  });

  it('makes a new one for another intent, and once the press was answered', () => {
    const store = tab();
    const before = createRetryKey(make, store);
    const key = before.next('order a');
    expect(createRetryKey(make, store).next('order b')).not.toBe(key);
    const again = createRetryKey(make, store);
    const answered = again.next('order b');
    again.settle(null);
    expect(store.read()).toBeNull();
    expect(createRetryKey(make, store).next('order b')).not.toBe(answered);
  });
});
