import { describe, expect, it } from 'vitest';

import type { ApiClient } from '@/api/client';

import { importVenueLayout } from './inventory-api';

const LAYOUT = { id: 'lv2', key: 'main', name: 'Main hall', version: 2, sections: [] };

describe('importing a layout CSV (PD-184)', () => {
  it('sends the file as a form with its key, name and version, to the venue’s profile', async () => {
    const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
    const api = {
      POST: (path: string, options: Record<string, unknown>) => {
        calls.push({ path, options });
        return Promise.resolve({ data: LAYOUT, response: new Response(null, { status: 201 }) });
      },
    } as unknown as ApiClient;
    const file = new File(['section_key\n'], 'hall.csv', { type: 'text/csv' });
    const layout = await importVenueLayout(api, 'vp1', {
      key: 'main',
      name: 'Main hall',
      expectedVersion: 1,
      file,
    });
    expect(layout.version).toBe(2);
    const [call] = calls;
    expect(call?.path).toBe('/api/v1/venue-profiles/{profileId}/ticket-layouts/import');
    expect(call?.options.params).toEqual({ path: { profileId: 'vp1' } });
    // openapi-fetch calls the serializer only when a body is given.
    expect(call?.options.body).toBeDefined();
    const serialize = call?.options.bodySerializer as () => FormData;
    const form = serialize();
    expect(form.get('key')).toBe('main');
    expect(form.get('name')).toBe('Main hall');
    expect(form.get('expectedVersion')).toBe('1');
    expect((form.get('file') as File).name).toBe('hall.csv');
  });
});
