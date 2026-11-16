import { describe, expect, it } from 'vitest';

import hy from '@/locales/hy/common.json';

import { meta } from './home';

type MetaArgs = Parameters<typeof meta>[0];

describe('the home page’s head', () => {
  it('lets search engines list it, described in the page’s language (PD-204)', () => {
    const tags = meta({ loaderData: { language: 'hy' } } as unknown as MetaArgs);
    expect(tags.some((tag) => 'name' in tag && tag.name === 'robots')).toBe(false);
    expect(tags).toContainEqual({ name: 'description', content: hy.home.body });
  });
});
