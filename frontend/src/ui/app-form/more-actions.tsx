import type { ReactNode } from 'react';

import { cx, Icon } from '@/ui';
import { cn } from '@/ui/cn';

const SUMMARY =
  'border-border flex min-h-11 w-full cursor-pointer list-none items-center justify-center gap-2 border px-3 text-sm font-medium sm:w-auto [&::-webkit-details-marker]:hidden';

/**
 * Actions used less often, behind one control: a native disclosure, as the kit has no menu (design
 * PD-90, PD-199). It works before hydration and needs no focus handling of its own. The panel is
 * `display: none` while closed: WebKit keeps a closed disclosure's content laid out, and its hidden
 * buttons would sit over the row's own.
 */
export function MoreActions({
  label,
  name,
  className,
  panelClassName,
  children,
}: {
  label: string;
  /** Its accessible name, when the label alone doesn't say whose actions they are. */
  name?: string | undefined;
  className?: string | undefined;
  panelClassName: string;
  children: ReactNode;
}) {
  return (
    <details className={cx('group relative', className)}>
      <summary aria-label={name} className={SUMMARY}>
        {label}
        <Icon
          name="chevron-down"
          size={16}
          className="transition-transform group-open:rotate-180"
        />
      </summary>
      <div
        className={cn(
          'bg-background border-border hidden flex-col gap-2 border group-open:flex',
          panelClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
}
