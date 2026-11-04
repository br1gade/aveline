import { preload } from 'react-dom';
import { describe, expect, it, vi } from 'vitest';

import { fontsToPreload, preloadFonts } from './fonts';

vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  preload: vi.fn(),
}));

describe('asking for a guest page’s fonts first', () => {
  it('asks for each as a font, anonymously, or the browser would download it twice', () => {
    preloadFonts('hy');
    const [serif, sans] = fontsToPreload('hy');
    const asked = { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' };
    expect(vi.mocked(preload).mock.calls).toEqual([
      [serif, asked],
      [sans, asked],
    ]);
  });
});
