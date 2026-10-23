import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { ButtonLink, StatusChip } from '@/ui';

import { REPLY_HEADING_ID, type ReplySummary } from './reply-summary';
import { useStatusText } from './status-text';

/** Whether any of some elements is on screen. `unknown` until the observer has first looked. */
export type Visibility = 'unknown' | 'none' | 'some';

/**
 * Watches the elements with these ids. It starts `unknown`, on the server and in the first client
 * render alike, so neither the reply bar nor the cover's status shows before the page knows where
 * the reply section is.
 */
export function useVisibility(ids: readonly string[]): Visibility {
  const [visibility, setVisibility] = useState<Visibility>('unknown');
  const key = ids.join(' ');
  useEffect(() => {
    const elements = key
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((element) => element !== null);
    if (elements.length === 0) return undefined;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setVisibility(visible.size === 0 ? 'none' : 'some');
    });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [key]);
  return visibility;
}

/** Reserves the bar's height, so it never covers a focused field (spec §4.7, §11). */
function useScrollPadding(bar: RefObject<HTMLElement | null>, isShown: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    if (!isShown || !bar.current) return undefined;
    root.style.scrollPaddingBottom = `${bar.current.offsetHeight}px`;
    return () => {
      root.style.scrollPaddingBottom = '';
    };
  }, [bar, isShown]);
}

interface ReplyBarProps {
  reply: ReplySummary | null;
  isShown: boolean;
}

/**
 * The sticky bar on phones and tablets (spec §4.7). The page decides when it shows: replies open,
 * a personal link, and neither the reply section nor the card's Reply on screen (R-14, PD-31).
 * Answered, the status sits above a full-width button below 480 px and beside it above (PD-27).
 */
export function ReplyBar({ reply, isShown }: ReplyBarProps) {
  const { t } = useTranslation('invitation');
  const bar = useRef<HTMLDivElement>(null);
  const statusText = useStatusText(reply);
  useScrollPadding(bar, isShown);

  return (
    <div
      ref={bar}
      hidden={!isShown}
      className="border-sand bg-porcelain text-ink fixed inset-x-0 bottom-0 z-20 flex flex-col gap-3 border-t px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] shadow-(--shadow-float) min-[480px]:flex-row min-[480px]:items-center lg:hidden"
    >
      {reply && statusText ? (
        <>
          <StatusChip status={reply.status} className="text-ink flex-auto">
            {statusText}
          </StatusChip>
          <ButtonLink
            href={`#${REPLY_HEADING_ID}`}
            variant="secondary"
            className="w-full min-[480px]:w-auto"
          >
            {t('personal.changeReply')}
          </ButtonLink>
        </>
      ) : (
        <ButtonLink href={`#${REPLY_HEADING_ID}`} isBlock>
          {t('personal.reply')}
        </ButtonLink>
      )}
    </div>
  );
}
