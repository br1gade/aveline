import { useEffect, useRef, useState, type ReactNode } from 'react';

import { readPrivateFile } from '@/api/private-file';
import { createQueue } from '@/lib/queue';

import { cx } from './cx';

/** Four pictures read at a time across the page; the rest wait their turn. */
const pictures = createQueue(4);

type Picture = { state: 'waiting' } | { state: 'ready'; url: string } | { state: 'failed' };

const WAITING: Picture = { state: 'waiting' };

export interface PrivateImageProps {
  /** Which picture this is: a new id reads again. */
  id: string;
  /** Reads the picture's bytes through the API client; called once it is near the screen. */
  load: (signal: AbortSignal) => Promise<Blob>;
  alt: string;
  /** For the picture and the space kept for it while it loads. */
  className?: string | undefined;
  /** In place of the picture when it could not be read; `retry` reads it again. */
  renderFailed: (retry: () => void) => ReactNode;
}

/** Whether the element is on screen or close to it; at once where nothing can tell (jsdom). */
export function useNearScreen(element: HTMLElement | null): boolean {
  const [isNear, setIsNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!element || isNear) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setIsNear(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, isNear]);
  return isNear;
}

function usePicture(id: string, load: PrivateImageProps['load'], isWanted: boolean) {
  // Each read is keyed by the picture and the attempt, so another picture or a retry starts as
  // "waiting" without setting state in the effect.
  const [attempt, setAttempt] = useState(0);
  const key = `${id}#${attempt}`;
  const [read, setRead] = useState<{ key: string; picture: Picture }>({ key, picture: WAITING });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!isWanted) return;
    const stop = new AbortController();
    let url: string | undefined;
    const readFile = () =>
      readPrivateFile(() => loadRef.current(stop.signal), { signal: stop.signal });
    pictures.run(readFile, stop.signal).then(
      (blob) => {
        if (stop.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setRead({ key, picture: { state: 'ready', url } });
      },
      () => {
        if (!stop.signal.aborted) setRead({ key, picture: { state: 'failed' } });
      },
    );
    return () => {
      stop.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [key, isWanted]);
  const picture = read.key === key ? read.picture : WAITING;
  return { picture, retry: () => setAttempt((count) => count + 1) };
}

/**
 * A private picture: read through the API once it is near the screen, and shown from an object URL,
 * so the page holds a `blob:` address and never the address the picture came from, which carries
 * a guest's token or needs the host's bearer token (docs/ARCHITECTURE.md §9). The URL is released
 * when the picture leaves the page.
 */
export function PrivateImage({ id, load, alt, className, renderFailed }: PrivateImageProps) {
  const [holder, setHolder] = useState<HTMLSpanElement | null>(null);
  const isNear = useNearScreen(holder);
  const { picture, retry } = usePicture(id, load, isNear);
  if (picture.state === 'ready') {
    return <img src={picture.url} alt={alt} decoding="async" className={className} />;
  }
  if (picture.state === 'failed') return <>{renderFailed(retry)}</>;
  return (
    <span
      ref={setHolder}
      {...(alt ? { role: 'img', 'aria-label': alt, 'aria-busy': true } : { 'aria-hidden': true })}
      className={cx('block motion-safe:animate-pulse', className)}
    />
  );
}
