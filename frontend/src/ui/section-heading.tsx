import type { ReactNode } from 'react';

import { cx } from './cx';

interface SectionHeadingProps {
  /** What the section is, in small capitals. Never a decorative number. */
  label?: ReactNode;
  /** The host's title or the block's default heading: an h2 in `heading-1`. */
  heading?: ReactNode;
  /** Makes the h2 a focus target, for "Reply" buttons that move focus to it. */
  id?: string | undefined;
  isCentred?: boolean;
  className?: string;
}

const EYEBROW = 'type-eyebrow text-label m-0 uppercase';

/**
 * An eyebrow above a heading: the start of every section (DESIGN_SYSTEM §9). Every section keeps
 * an h2 (spec §11): without a heading, the eyebrow itself is the h2.
 */
export function SectionHeading({
  label,
  heading,
  id,
  isCentred = false,
  className,
}: SectionHeadingProps) {
  const focusTarget = id ? { id, tabIndex: -1 } : {};
  return (
    <div className={cx('flex flex-col gap-3', isCentred && 'items-center text-center', className)}>
      {heading ? (
        <>
          {label ? <p className={EYEBROW}>{label}</p> : null}
          <h2 {...focusTarget} className="type-heading-1 text-heading m-0 scroll-mt-6">
            {heading}
          </h2>
        </>
      ) : (
        <h2 {...focusTarget} className={cx(EYEBROW, 'scroll-mt-6')}>
          {label}
        </h2>
      )}
    </div>
  );
}

/** An eyebrow on its own, where a heading is not wanted. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(EYEBROW, className)}>{children}</p>;
}
