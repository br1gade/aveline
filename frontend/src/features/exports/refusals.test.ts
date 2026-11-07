import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { intentOf } from './intent';
import { createRefusalOf, downloadRefusalOf, wrongTypeRefusal } from './refusals';
import { snapshot } from './test-data';
import type { ExportKind } from './types';

const refused = (status: number, messages: string[] = [], requestId?: string) =>
  new ApiError({ status, messages, requestId });

const intent = (kind: ExportKind, withContacts = true) =>
  intentOf({ kind, format: 'PDF', locale: 'hy', withContacts });

const fresh = (kind: ExportKind = 'GUEST_LIST', withContacts = true) => ({
  intent: intent(kind, withContacts),
  isKeyReused: false,
  activeCount: 2,
});

describe('a refused export, in our words', () => {
  it('offers a copy without email and phone when contact access is missing', () => {
    expect(createRefusalOf(refused(403), fresh())).toMatchObject({
      key: 'create.contacts',
      offer: 'redacted',
    });
  });

  it('explains that a ticket manifest needs contact access, and offers nothing', () => {
    expect(createRefusalOf(refused(403), fresh('TICKET_MANIFEST'))).toMatchObject({
      key: 'create.manifest',
      offer: null,
    });
  });

  it('reads a 403 on a file without contacts as no access to exports at all', () => {
    expect(createRefusalOf(refused(403), fresh('GUEST_LIST', false)).key).toBe('create.forbidden');
    expect(createRefusalOf(refused(403), fresh('SEATING_CHART')).key).toBe('create.forbidden');
  });

  it('reads a 409 on a new key as the ten exports an event may have going', () => {
    expect(createRefusalOf(refused(409), fresh())).toMatchObject({
      key: 'create.queueFull',
      reloadsList: true,
    });
  });

  it('reads a 409 on a key sent again as the key used for another export, unless ten are going', () => {
    const again = { ...fresh(), isKeyReused: true };
    expect(createRefusalOf(refused(409), again).key).toBe('create.keyReused');
    expect(createRefusalOf(refused(409), { ...again, activeCount: 10 }).key).toBe(
      'create.queueFull',
    );
  });

  it('shows the backend’s sentences under ours for a 400 and anything unforeseen', () => {
    const check = createRefusalOf(refused(400, ['kind must be one of …']), fresh());
    expect(check).toMatchObject({ key: 'create.check', messages: ['kind must be one of …'] });
    expect(createRefusalOf(refused(422, ['?']), fresh())).toMatchObject({
      key: 'other',
      messages: ['?'],
    });
  });

  it('words an event gone, no answer, a rate limit and a server failure with its reference', () => {
    expect(createRefusalOf(refused(404), fresh()).key).toBe('create.eventMissing');
    expect(createRefusalOf(refused(0), fresh()).key).toBe('create.unreachable');
    expect(createRefusalOf(refused(429), fresh()).key).toBe('rateLimited');
    expect(createRefusalOf(refused(500, [], 'req-9'), fresh())).toMatchObject({
      key: 'server',
      requestId: 'req-9',
    });
    expect(createRefusalOf(new Error('bug'), fresh()).key).toBe('server');
  });
});

describe('a refused download, in our words', () => {
  const ready = snapshot();

  it('offers a copy without email and phone once contact access is lost', () => {
    expect(downloadRefusalOf(refused(403), ready)).toMatchObject({
      key: 'download.contacts',
      offer: 'redacted',
    });
  });

  it('says a ticket manifest cannot be downloaded without contact access', () => {
    const manifest = snapshot({ kind: 'TICKET_MANIFEST' });
    expect(downloadRefusalOf(refused(403), manifest)).toMatchObject({
      key: 'download.manifest',
      offer: null,
    });
  });

  it('reads a 403 on a file without contacts as access to exports lost', () => {
    const redacted = snapshot({ includesContacts: false });
    expect(downloadRefusalOf(refused(403), redacted).key).toBe('download.forbidden');
  });

  it('follows a file that is still being made', () => {
    const going = snapshot({ status: 'RUNNING', isDownloadable: false });
    expect(downloadRefusalOf(refused(409), ready, going)).toMatchObject({
      key: 'download.notReady',
      follows: true,
    });
    expect(downloadRefusalOf(refused(409), ready).follows).toBe(true);
  });

  it('offers the download again when the file was ready by the time it was read again', () => {
    expect(downloadRefusalOf(refused(409), ready, snapshot())).toMatchObject({
      key: 'download.nowReady',
      offer: 'tryAgain',
      follows: false,
    });
  });

  it('points to the row when the file ended without one', () => {
    const failed = snapshot({
      status: 'FAILED',
      failureReason: 'GENERATION_FAILED',
      isDownloadable: false,
    });
    expect(downloadRefusalOf(refused(409), ready, failed)).toMatchObject({
      key: 'download.notMade',
      offer: null,
      follows: false,
    });
  });

  it('tells withdrawn from expired by reading the export again', () => {
    const withdrawn = snapshot({ revokedAt: '2026-10-31T09:00:00.000Z', isDownloadable: false });
    const expired = snapshot({ isDownloadable: false });
    expect(downloadRefusalOf(refused(410), ready, withdrawn).key).toBe('download.withdrawn');
    expect(downloadRefusalOf(refused(410), ready, expired).key).toBe('download.expired');
    expect(downloadRefusalOf(refused(410), ready).key).toBe('download.gone');
    expect(downloadRefusalOf(refused(410), ready, expired).offer).toBe('makeAgain');
  });

  it('offers to try again when the file store or the connection did not answer', () => {
    expect(downloadRefusalOf(refused(503), ready)).toMatchObject({
      key: 'download.storage',
      offer: 'tryAgain',
    });
    expect(downloadRefusalOf(refused(0), ready)).toMatchObject({
      key: 'download.unreachable',
      offer: 'tryAgain',
    });
  });

  it('reads the history again when the export is gone from the event', () => {
    expect(downloadRefusalOf(refused(404), ready)).toMatchObject({
      key: 'download.missing',
      reloadsList: true,
    });
  });

  it('words a rate limit and a server failure with its reference', () => {
    expect(downloadRefusalOf(refused(429), ready).key).toBe('rateLimited');
    expect(downloadRefusalOf(refused(502, [], 'req-2'), ready)).toMatchObject({
      key: 'server',
      requestId: 'req-2',
    });
  });

  it('refuses a file of another type than the one asked for, as a server failure', () => {
    expect(wrongTypeRefusal()).toMatchObject({ key: 'download.wrongType', offer: 'tryAgain' });
  });
});
