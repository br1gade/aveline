import { z } from 'zod';

import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

type Schemas = components['schemas'];

const layoutSummary = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  version: z.number(),
});
const section = z.object({ key: z.string(), name: z.string() });
const geometry = z.discriminatedUnion('mode', [
  section.extend({
    mode: z.literal('NUMBERED'),
    rows: z.array(z.object({ label: z.string(), seats: z.array(z.string()) })),
  }),
  section.extend({ mode: z.literal('UNNUMBERED'), capacity: z.number() }),
]);
const layout = layoutSummary.extend({ sections: z.array(geometry) });
const published = z.object({
  venueId: z.string(),
  layoutVersionId: z.string(),
  sections: z.array(section.extend({ capacity: z.number().nullable() })),
});

export type VenueLayout = z.infer<typeof layout>;
export type LayoutSummary = z.infer<typeof layoutSummary>;
export type PublishedInventory = z.infer<typeof published>;

export async function readInventory(api: ApiClient, eventId: string) {
  const result = await api.GET('/api/v1/events/{eventId}/ticket-inventory', {
    params: { path: { eventId } },
  });
  if (result.response.ok && result.data === undefined) return null;
  return published.nullable().parse(await expectData(Promise.resolve(result)));
}

export async function listVenueLayouts(api: ApiClient, path: { eventId: string; venueId: string }) {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/venues/{venueId}/ticket-layouts', { params: { path } }),
  );
  return z.array(layoutSummary).parse(wire);
}

export async function readVenueLayout(
  api: ApiClient,
  path: { eventId: string; venueId: string; versionId: string },
) {
  const wire = await expectData(
    api.GET('/api/v1/events/{eventId}/venues/{venueId}/ticket-layouts/{versionId}', {
      params: { path },
    }),
  );
  return layout.parse(wire);
}

export async function publishVenueLayout(
  api: ApiClient,
  profileId: string,
  body: Schemas['PublishVenueTicketLayoutDto'],
) {
  const wire = await expectData(
    api.POST('/api/v1/venue-profiles/{profileId}/ticket-layouts', {
      params: { path: { profileId } },
      body,
    }),
  );
  return layout.parse(wire);
}

export async function publishInventory(
  api: ApiClient,
  eventId: string,
  body: Schemas['PublishShowTicketInventoryDto'],
) {
  const wire = await expectData(
    api.POST('/api/v1/events/{eventId}/ticket-inventory', { params: { path: { eventId } }, body }),
  );
  return published.parse(wire);
}

export async function importVenueLayout(
  api: ApiClient,
  profileId: string,
  input: { key: string; name: string; expectedVersion: number; file: File },
) {
  const form = new FormData();
  form.set('key', input.key);
  form.set('name', input.name);
  form.set('expectedVersion', String(input.expectedVersion));
  form.set('file', input.file, input.file.name);
  const wire = await expectData(
    api.POST('/api/v1/venue-profiles/{profileId}/ticket-layouts/import', {
      params: { path: { profileId } },
      body: {
        key: input.key,
        name: input.name,
        expectedVersion: input.expectedVersion,
        file: input.file.name,
      },
      bodySerializer: () => form,
    }),
  );
  return layout.parse(wire);
}
