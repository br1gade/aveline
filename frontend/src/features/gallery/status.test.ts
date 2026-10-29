import { describe, expect, it } from 'vitest';

import { failureOf, guestState, isSettled, tabOf } from './status';
import { photo } from './test-data';

describe('a photo’s state for the guest who shared it (PD-63)', () => {
  it.each([
    ['STAGING', 'PENDING', 'preparing'],
    ['QUEUED', 'PENDING', 'preparing'],
    ['PROCESSING', 'PENDING', 'preparing'],
    ['READY', 'PENDING', 'waiting'],
    ['READY', 'APPROVED', 'shown'],
    ['READY', 'REJECTED', 'notApproved'],
    ['FAILED', 'PENDING', 'failed'],
    ['SOMETHING_NEW', 'PENDING', 'preparing'],
    ['READY', 'SOMETHING_NEW', 'waiting'],
  ])('%s and %s is %s', (processing, moderation, state) => {
    expect(guestState(photo({ processing, moderation }))).toBe(state);
  });
});

describe('a photo’s tab for the hosts (PD-65)', () => {
  it.each([
    ['READY', 'PENDING', 'review'],
    ['READY', 'APPROVED', 'approved'],
    ['READY', 'REJECTED', 'hidden'],
    ['QUEUED', 'PENDING', 'other'],
    ['PROCESSING', 'APPROVED', 'other'],
    ['FAILED', 'PENDING', 'other'],
  ])('%s and %s is under %s', (processing, moderation, tab) => {
    expect(tabOf(photo({ processing, moderation }))).toBe(tab);
  });
});

describe('the worker’s outcome', () => {
  it('is settled once ready or failed', () => {
    expect(isSettled(photo({ processing: 'READY' }))).toBe(true);
    expect(isSettled(photo({ processing: 'FAILED' }))).toBe(true);
    expect(isSettled(photo({ processing: 'QUEUED' }))).toBe(false);
  });

  it('tells an unreadable image from a failure on our side', () => {
    expect(failureOf(photo({ processing: 'FAILED', failure: 'INVALID_IMAGE' }))).toBe('invalid');
    expect(failureOf(photo({ processing: 'FAILED', failure: 'ATTEMPTS_EXHAUSTED' }))).toBe('ours');
    expect(failureOf(photo({ processing: 'FAILED', failure: 'STORAGE_UNAVAILABLE' }))).toBe('ours');
    expect(failureOf(photo({ processing: 'READY' }))).toBeNull();
  });
});
