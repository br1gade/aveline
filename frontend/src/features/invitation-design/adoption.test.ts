// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { plantedToken } from '../../../test/tokens';
import { adoptionRefusalOf, isPreviewRequired, readAdoption } from './adoption';

function refused(status: number, code: string | undefined, message = 'No') {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('a template version’s preview', () => {
  const ready = {
    previewId: 'p1',
    state: 'READY',
    sourceVersionId: 'v1',
    targetVersionId: 'v2',
    expectedDesignRevision: '7',
    sourceHash: 'h',
    targetHash: 'h2',
    expiresAt: '2026-11-04T11:00:00Z',
    changes: {
      themeReset: true,
      disabledBlocks: ['MAP'],
      resetVariants: ['HERO'],
      assetDefaults: [],
    },
    payloads: {
      hy: { locale: 'hy', coverUrl: null, blocks: [] },
    },
  };

  it('keeps what confirming needs, and what it says', () => {
    expect(readAdoption(ready)).toMatchObject({
      state: 'ready',
      previewId: 'p1',
      sourceVersionId: 'v1',
      expectedDesignRevision: '7',
      changes: { themeReset: true, disabledBlocks: ['MAP'], resetVariants: ['HERO'] },
    });
  });

  it('rewrites private artwork in each language’s page', () => {
    const token = plantedToken();
    const read = readAdoption({
      ...ready,
      payloads: {
        hy: {
          locale: 'hy',
          coverUrl: `/api/v1/invitations/a/g/${token}/design-assets/c/file`,
          blocks: [
            {
              type: 'HERO',
              media: [{ id: 'a1', url: '/api/v1/events/e1/design-assets/a1/file' }],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(read)).not.toContain('design-assets');
    expect(JSON.stringify(read)).not.toContain(token);
    expect(read.state === 'ready' && read.payloads.hy?.blocks[0]?.media[0]?.privateAsset).toEqual({
      id: 'a1',
    });
  });

  it.each([
    [{ previewId: 'p1', state: 'PROCESSING', expiresAt: 'x', pollUrl: '/x' }, 'processing'],
    [{ previewId: 'p1', state: 'QUEUED', expiresAt: 'x' }, 'processing'],
    [
      { previewId: 'p1', state: 'FAILED', code: 'TEMPLATE_ASSET_INVALID', action: 'REGENERATE' },
      'failed',
    ],
  ])('reads %o', (wire, expected) => {
    expect(readAdoption(wire).state).toBe(expected);
  });

  it('never keeps the address to poll: the client builds its own', () => {
    expect(
      JSON.stringify(readAdoption({ previewId: 'p1', state: 'PROCESSING', pollUrl: '/x' })),
    ).not.toContain('/x');
  });
});

describe('a refusal, by its stable code', () => {
  it('knows a key-only choice of an authored template', () => {
    expect(isPreviewRequired(refused(409, 'TEMPLATE_PREVIEW_REQUIRED'))).toBe(true);
    expect(isPreviewRequired(refused(409, 'CONFLICT'))).toBe(false);
    expect(isPreviewRequired(new Error('x'))).toBe(false);
  });

  it.each([
    [409, 'TEMPLATE_PREVIEW_STALE', 'stale'],
    [409, 'TEMPLATE_PREVIEW_UNAVAILABLE', 'stale'],
    [409, 'TEMPLATE_IDEMPOTENCY_CONFLICT', 'stale'],
    [409, 'TEMPLATE_STATE_CHANGED', 'gone'],
    [404, 'TEMPLATE_NOT_FOUND', 'gone'],
    [409, 'TEMPLATE_ASSET_NOT_READY', 'preparing'],
    [400, 'TEMPLATE_ASSET_INVALID', 'invalid'],
    [503, 'TEMPLATE_FEATURE_DISABLED', 'unavailable'],
    [503, 'TEMPLATE_CAPABILITY_NOT_DEPLOYED', 'unavailable'],
    [409, 'TEMPLATE_CAPABILITY_REQUIRED', 'unavailable'],
    [403, 'FORBIDDEN', 'forbidden'],
    [429, undefined, 'rateLimited'],
  ])('%i %s is %s', (status, code, kind) => {
    expect(adoptionRefusalOf(refused(status, code)).kind).toBe(kind);
  });

  it('keeps a reference for no answer, and shows anything else as it came', () => {
    expect(adoptionRefusalOf(refused(500, undefined))).toEqual({
      kind: 'noAnswer',
      requestId: 'r-1',
    });
    expect(
      adoptionRefusalOf(refused(409, 'CONFLICT', 'Archived events cannot change design')),
    ).toEqual({
      kind: 'other',
      sentence: 'Archived events cannot change design',
    });
  });

  it('holds to the codes the backend has', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../../../backend/src/common/domain-http.exception.ts'),
      'utf8',
    );
    for (const code of [
      'TEMPLATE_PREVIEW_REQUIRED',
      'TEMPLATE_PREVIEW_STALE',
      'TEMPLATE_PREVIEW_UNAVAILABLE',
      'TEMPLATE_IDEMPOTENCY_CONFLICT',
      'TEMPLATE_STATE_CHANGED',
      'TEMPLATE_NOT_FOUND',
      'TEMPLATE_ASSET_NOT_READY',
      'TEMPLATE_ASSET_INVALID',
      'TEMPLATE_FEATURE_DISABLED',
      'TEMPLATE_CAPABILITY_NOT_DEPLOYED',
      'TEMPLATE_CAPABILITY_REQUIRED',
    ]) {
      expect(source).toContain(`${code}:`);
    }
  });
});
