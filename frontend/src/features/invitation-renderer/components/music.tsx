import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cx, Icon } from '@/ui';

import { rememberedMusic, rememberMusic } from './music-choice';

/**
 * The invitation's one audio track (design R-20): off until the guest presses play, paused when
 * the page is hidden, and always stoppable. The audio element is created when first wanted, so a
 * page with music downloads nothing until then. The choice lasts the session (spec §10).
 */
interface MusicState {
  isPlaying: boolean;
  toggle: () => void;
}

const MusicContext = createContext<MusicState | null>(null);

export function MusicProvider({ url, children }: { url: string | null; children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const start = useCallback(() => {
    if (!url) return;
    audio.current ??= Object.assign(new Audio(url), { loop: true });
    audio.current.play().then(
      () => setIsPlaying(true),
      () => setIsPlaying(false),
    );
  }, [url]);

  const toggle = useCallback(() => {
    if (!url) return;
    if (audio.current && !audio.current.paused) {
      audio.current.pause();
      setIsPlaying(false);
      rememberMusic('off');
    } else {
      rememberMusic('on');
      start();
    }
  }, [url, start]);

  // Asked for earlier in this session: one try. A browser refuses sound before a press on a fresh
  // load, and then the control simply says off, until pressed (design PD-143).
  useEffect(() => {
    if (rememberedMusic() === 'on') start();
  }, [start]);

  useEffect(() => {
    function pauseWhenHidden() {
      if (document.hidden && audio.current && !audio.current.paused) {
        audio.current.pause();
        setIsPlaying(false);
      }
    }
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden);
      audio.current?.pause();
    };
  }, []);

  const value = url ? { isPlaying, toggle } : null;
  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

export function useMusic(): MusicState | null {
  return useContext(MusicContext);
}

/** "Music: off" / "Music: on", in words, with `aria-pressed` (design §10). */
export function MusicControl({ className }: { className?: string }) {
  const { t } = useTranslation('invitation');
  const music = useMusic();
  if (!music) return null;
  return (
    <button
      type="button"
      aria-pressed={music.isPlaying}
      onClick={music.toggle}
      className={cx(
        'border-control-edge inline-flex min-h-(--target-min) min-w-(--target-min) cursor-pointer items-center gap-2 border bg-transparent px-3',
        'text-text hover:bg-surface-sunken text-[12px] leading-4 font-medium tracking-[0.14em] uppercase',
        'aria-pressed:border-action aria-pressed:text-heading',
        className,
      )}
    >
      <Icon name={music.isPlaying ? 'volume-2' : 'volume-x'} />
      {music.isPlaying ? t('music.on') : t('music.off')}
    </button>
  );
}

/** While music plays, a pause button stays pinned top-right inside the safe area. */
export function FloatingPause() {
  const { t } = useTranslation('invitation');
  const music = useMusic();
  if (!music?.isPlaying) return null;
  return (
    <button
      type="button"
      onClick={music.toggle}
      aria-label={t('music.pause')}
      className="border-line bg-porcelain text-ink fixed top-[max(12px,env(safe-area-inset-top))] right-[max(12px,env(safe-area-inset-right))] z-30 inline-flex size-11 cursor-pointer items-center justify-center border shadow-(--shadow-float)"
    >
      <Icon name="pause" />
    </button>
  );
}
