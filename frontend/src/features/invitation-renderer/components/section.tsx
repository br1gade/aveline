import { useEffect, useRef, type ReactNode } from 'react';

import { cx } from '@/ui';

/**
 * Gutters: 16 px below 360, 20 on phones, 32 at `sm`, 40 at `md`, 64 at `lg` (DESIGN_SYSTEM §4.3).
 * The column's width comes from `--letter-column`, which the page sets for its layout.
 */
export const GUTTERS = 'px-5 max-[359px]:px-4 sm:px-8 md:px-10 lg:px-16';
export const COLUMN = 'mx-auto w-full max-w-(--letter-column)';

interface SectionProps {
  children: ReactNode;
  id?: string | undefined;
  className?: string;
  /** Classes for the column inside the gutters. */
  columnClassName?: string;
}

/**
 * A section rises as it first enters the screen (spec §10, design PD-142). Nothing starts hidden and
 * no state changes: only a class, on a section that was below the screen when the page opened, whose
 * CSS moves it and does nothing under `prefers-reduced-motion`. Without an observer, it simply stands.
 */
function useRiseOnEnter() {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = element.current;
    if (!section || typeof IntersectionObserver === 'undefined') return;
    let isFirst = true;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        if (!isFirst) section.classList.add('section-rise');
        observer.disconnect();
      }
      isFirst = false;
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);
  return element;
}

/** One section of the letter: 64 px above it on phones, 96 on desktop (DESIGN_SYSTEM §4.1). */
export function Section({ children, id, className, columnClassName }: SectionProps) {
  const element = useRiseOnEnter();
  return (
    <section ref={element} id={id} className={cx(GUTTERS, 'pt-16 lg:pt-24', className)}>
      <div className={cx(COLUMN, 'flex flex-col gap-6', columnClassName)}>{children}</div>
    </section>
  );
}

/** The layout a block asked for, or the first (the default) when it named none or an unknown one. */
export function variantOf<V extends string>(
  variant: string | null,
  variants: readonly [V, ...V[]],
): V {
  return variants.find((candidate) => candidate === variant) ?? variants[0];
}
