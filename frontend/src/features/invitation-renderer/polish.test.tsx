import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createI18n } from '@/lib/i18n';

import { MusicControl, MusicProvider } from './components/music';
import { Section } from './components/section';
import { fontsToPreload } from './fonts';

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('remembering the music for the session', () => {
  class FakeAudio {
    paused = true;
    loop = false;
    constructor(readonly src: string) {}
    play = vi.fn(() => {
      if (FakeAudio.isRefused) return Promise.reject(new Error('NotAllowedError'));
      this.paused = false;
      return Promise.resolve();
    });
    pause = vi.fn(() => {
      this.paused = true;
    });
    static isRefused = false;
  }
  let made: FakeAudio[];

  beforeEach(() => {
    made = [];
    FakeAudio.isRefused = false;
    vi.stubGlobal(
      'Audio',
      class extends FakeAudio {
        constructor(src: string) {
          super(src);
          made.push(this);
        }
      },
    );
  });

  function show() {
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <MusicProvider url="https://media.example/song.mp3">
          <MusicControl />
        </MusicProvider>
      </I18nextProvider>,
    );
  }

  it('stays off and downloads nothing with no choice made', () => {
    show();
    expect(screen.getByRole('button', { name: 'Music: off' })).toBeInTheDocument();
    expect(made).toHaveLength(0);
  });

  it('remembers a press, in this tab’s session, with nothing but on or off', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Music: off' }));
    expect(await screen.findByRole('button', { name: 'Music: on' })).toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem('aveline-music')).toBe('on');
    expect(window.localStorage.length).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Music: on' }));
    expect(window.sessionStorage.getItem('aveline-music')).toBe('off');
  });

  it('plays again on the next page of the session', async () => {
    window.sessionStorage.setItem('aveline-music', 'on');
    show();
    expect(await screen.findByRole('button', { name: 'Music: on' })).toBeInTheDocument();
  });

  it('says off when the browser refuses sound before a press, with one try', async () => {
    FakeAudio.isRefused = true;
    window.sessionStorage.setItem('aveline-music', 'on');
    show();
    await vi.waitFor(() => expect(made[0]?.play).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Music: off' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('aveline-music')).toBe('on');
  });

  it('starts nothing when the choice was off', () => {
    window.sessionStorage.setItem('aveline-music', 'off');
    show();
    expect(made).toHaveLength(0);
  });

  it('keeps the choice when the page is hidden, which only pauses it', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Music: off' }));
    await screen.findByRole('button', { name: 'Music: on' });
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByRole('button', { name: 'Music: off' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('aveline-music')).toBe('on');
  });

  it('works where the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('refused');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('refused');
    });
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Music: off' }));
    expect(await screen.findByRole('button', { name: 'Music: on' })).toBeInTheDocument();
  });
});

describe('a section rising as it enters', () => {
  type Observed = (entries: { isIntersecting: boolean }[]) => void;
  let observed: Observed;
  const disconnect = vi.fn();

  beforeEach(() => {
    disconnect.mockClear();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: Observed) {
          observed = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
  });

  function show() {
    const { container, unmount } = render(<Section id="s">Words</Section>);
    const section = container.querySelector('section');
    if (!section) throw new Error('No section');
    return { section, unmount };
  }

  it('leaves one on screen when the page opens as it is', () => {
    const { section } = show();
    observed([{ isIntersecting: true }]);
    expect(section).not.toHaveClass('section-rise');
    expect(disconnect).toHaveBeenCalled();
  });

  it('rises once, when one from below the screen first enters', () => {
    const { section } = show();
    observed([{ isIntersecting: false }]);
    expect(section).not.toHaveClass('section-rise');
    observed([{ isIntersecting: true }]);
    expect(section).toHaveClass('section-rise');
    expect(disconnect).toHaveBeenCalled();
  });

  it('is never hidden, before or after', () => {
    const { section } = show();
    expect(section).toBeVisible();
    expect(section.getAttribute('style')).toBeNull();
    observed([{ isIntersecting: false }]);
    expect(section).toBeVisible();
    observed([{ isIntersecting: true }]);
    expect(section).toBeVisible();
  });

  it('stands as it is with no observer', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const { section } = show();
    expect(section).toHaveTextContent('Words');
  });

  it('stops watching when it leaves the page', () => {
    const { unmount } = show();
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});

/** The rule that opens at `start`, to its closing brace. */
function blockFrom(css: string, start: number): string {
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  throw new Error('No end to the rule');
}

describe('the motion’s rules', () => {
  const css = readFileSync(join(import.meta.dirname, '../../styles/app.css'), 'utf8');
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  const motion = blockFrom(css, start);
  const elsewhere = css.slice(0, start) + css.slice(start + motion.length);

  it('moves nothing unless motion is welcome', () => {
    expect(motion).toContain('.cover-rise');
    expect(motion).toContain('.section-rise');
    expect(elsewhere).not.toContain('.cover-rise');
    expect(elsewhere).not.toContain('.section-rise');
  });

  it('never touches opacity, so nothing starts hidden', () => {
    expect(motion).not.toMatch(/opacity|visibility/);
  });

  it('holds to the spec’s timing: 8 px, 600 ms for the cover, 80 ms apart, 300 ms a section', () => {
    expect(motion).toContain('translateY(8px)');
    expect(motion).toContain('rise 600ms');
    expect(motion).toContain('animation-delay: 80ms');
    expect(motion).toContain('rise 300ms');
  });
});

describe('the fonts a guest page asks for first', () => {
  it.each(['hy', 'ru', 'en', 'fr', 'xx'])('%s: the serif and the sans, no more', (language) => {
    expect(fontsToPreload(language)).toHaveLength(2);
  });

  it('asks for the script the page is in', () => {
    expect(fontsToPreload('hy').join()).toContain('armenian-armenian');
    expect(fontsToPreload('ru').join()).toContain('cyrillic');
    expect(fontsToPreload('en').join()).toContain('latin');
    expect(fontsToPreload('fr')).toEqual(fontsToPreload('en'));
  });
});
