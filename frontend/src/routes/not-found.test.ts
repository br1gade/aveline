import { describe, expect, it } from 'vitest';

import { loader } from './not-found';

type LoaderArgs = Parameters<typeof loader>[0];

function visit(headers: Record<string, string>) {
  return loader({
    request: new Request('http://aveline.test/no-such-page', { headers }),
  } as LoaderArgs);
}

describe('a page that does not exist (audit F-15)', () => {
  it('says so in the language the visitor chose, as a 404', () => {
    const result = visit({ cookie: 'aveline-lang=hy' });
    expect(result.data).toEqual({ language: 'hy' });
    expect(result.init?.status).toBe(404);
  });

  it('follows the browser when nothing was chosen', () => {
    expect(visit({ 'accept-language': 'ru-RU,ru;q=0.9' }).data).toEqual({ language: 'ru' });
  });
});
