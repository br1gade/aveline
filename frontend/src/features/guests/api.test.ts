// @vitest-environment node
// Node's fetch, FormData and File together, as a browser has its own: jsdom's FormData and File are
// not Node's, and Node's fetch refuses to send them, so a multipart body is tested here.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createAppApi } from '@/api/client';
import { isApiError } from '@/api/errors';

import { addGuest, importGuests, listGuests, removeGuest, updateGuest } from './api';
import { guestWire, householdWire } from './test-data';

const ORIGIN = 'http://api.test';
const API = `${ORIGIN}/api/v1`;
const server = setupServer();
const api = createAppApi(ORIGIN, {});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('importGuests', () => {
  it('sends the file in the one multipart field the backend reads, `file`', async () => {
    const received: Array<{ field: string; name: string; text: string; type: string | null }> = [];
    server.use(
      http.post(`${API}/events/e1/guests/import`, async ({ request }) => {
        const form = await request.formData();
        for (const [field, value] of form.entries()) {
          if (typeof value !== 'string') {
            received.push({
              field,
              name: value.name,
              text: await value.text(),
              type: request.headers.get('content-type'),
            });
          }
        }
        return HttpResponse.json(
          { importId: 'i1', status: 'COMPLETED', rowsImported: 1, rowsFailed: 0, errors: [] },
          { status: 201 },
        );
      }),
    );
    const file = new File(['first name\nAni\n'], 'guests.csv', { type: 'text/csv' });
    const result = await importGuests(api, 'e1', file);
    expect(result).toEqual({ status: 'COMPLETED', rowsImported: 1, rowsFailed: 0, errors: [] });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      field: 'file',
      name: 'guests.csv',
      text: 'first name\nAni\n',
    });
    // The boundary is the runtime's own, never a JSON content type set by the client.
    expect(received[0]?.type).toMatch(/^multipart\/form-data; boundary=/);
  });

  it('reads a partial import as a result, not an error', async () => {
    server.use(
      http.post(`${API}/events/e1/guests/import`, () =>
        HttpResponse.json(
          {
            importId: 'i2',
            status: 'PARTIAL',
            rowsImported: 1,
            rowsFailed: 1,
            errors: [{ row: 3, message: 'No name in this row' }],
          },
          { status: 201 },
        ),
      ),
    );
    const result = await importGuests(api, 'e1', new File(['x'], 'guests.csv'));
    expect(result.errors).toEqual([{ row: 3, message: 'No name in this row', value: null }]);
  });

  it('turns a 413 into an error with its status', async () => {
    server.use(
      http.post(`${API}/events/e1/guests/import`, () =>
        HttpResponse.json({ statusCode: 413, message: 'File too large' }, { status: 413 }),
      ),
    );
    const error: unknown = await importGuests(api, 'e1', new File(['x'], 'guests.csv')).catch(
      (thrown: unknown) => thrown,
    );
    expect(isApiError(error) && error.status).toBe(413);
  });
});

describe('the token stops at the API module', () => {
  it('reads the list without any guest’s token', async () => {
    const token = crypto.randomUUID();
    server.use(
      http.get(`${API}/events/e1/guests`, () =>
        HttpResponse.json([householdWire({ guests: [guestWire({ token })] })]),
      ),
    );
    expect(JSON.stringify(await listGuests(api, 'e1'))).not.toContain(token);
  });

  it('gives back nothing from adding or editing, whose answers carry the token', async () => {
    const token = crypto.randomUUID();
    const withToken = () => HttpResponse.json({ id: 'g9', householdId: 'h9', token });
    server.use(
      http.post(`${API}/events/e1/guests`, withToken),
      http.patch(`${API}/events/e1/guests/g9`, withToken),
    );
    await expect(addGuest(api, 'e1', { firstName: 'Lilit' })).resolves.toBeUndefined();
    await expect(updateGuest(api, 'e1', 'g9', { lastName: 'Hakobyan' })).resolves.toBeUndefined();
  });

  it('keeps only whether the household went too from a removal', async () => {
    server.use(
      http.delete(`${API}/events/e1/guests/g9`, () =>
        HttpResponse.json({ removed: 'g9', isHouseholdRemoved: true }),
      ),
    );
    await expect(removeGuest(api, 'e1', 'g9')).resolves.toEqual({ isHouseholdRemoved: true });
  });
});
