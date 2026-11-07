// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { initialFiles, overBudget } from './check-budgets.mjs';

const manifest = {
  entry: { module: '/assets/entry.js', imports: ['/assets/runtime.js'], css: [] },
  routes: {
    root: { module: '/assets/root.js', imports: ['/assets/runtime.js'], css: ['/assets/root.css'] },
    'routes/public/invitation': {
      module: '/assets/invitation.js',
      imports: ['/assets/shared.js'],
      css: [],
    },
    'routes/app/home': { module: '/assets/home.js', imports: ['/assets/app-only.js'], css: [] },
  },
};

describe('what a guest route loads first', () => {
  it('counts the entry, the root and the route, once each', () => {
    const { js, css } = initialFiles(manifest, 'routes/public/invitation');
    expect(js.toSorted()).toEqual(
      [
        '/assets/entry.js',
        '/assets/invitation.js',
        '/assets/root.js',
        '/assets/runtime.js',
        '/assets/shared.js',
      ].toSorted(),
    );
    expect(css).toEqual(['/assets/root.css']);
  });

  it('counts nothing of another route', () => {
    expect(initialFiles(manifest, 'routes/public/invitation').js).not.toContain(
      '/assets/app-only.js',
    );
  });

  it('refuses a route the manifest lacks, rather than passing it', () => {
    expect(() => initialFiles(manifest, 'routes/public/gone')).toThrow('routes/public/gone');
  });
});

describe('the verdict', () => {
  const budget = { js: 100, css: 10 };

  it.each([
    [{ js: 100, css: 10 }, []],
    [{ js: 99, css: 9 }, []],
    [{ js: 101, css: 10 }, ['js']],
    [{ js: 100, css: 11 }, ['css']],
    [{ js: 101, css: 11 }, ['js', 'css']],
  ])('%o is over in %o', (size, expected) => {
    expect(overBudget(size, budget).map(({ kind }) => kind)).toEqual(expected);
  });
});
