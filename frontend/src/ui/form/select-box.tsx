import type { ComponentProps } from 'react';

import { cx } from '../cx';
import { Icon } from '../icon';

type SelectBoxProps = ComponentProps<'select'> & {
  /** Classes for the box around the select and its chevron: its width, its place in a grid. */
  frameClassName?: string | undefined;
};

/**
 * A native select drawn the same on every browser. WebKit draws its own menu button at the text's
 * height and ignores a minimum height, which left a 27 px target on iPhones (audit F-17), so the
 * box takes the control height itself, without the browser's look, and draws its chevron. The
 * caller gives the padding, leaving room on the right for the chevron.
 */
export function SelectBox({ className, frameClassName, ...select }: SelectBoxProps) {
  return (
    <div className={cx('relative', frameClassName)}>
      <select className={cx('h-(--control-height) appearance-none', className)} {...select} />
      <Icon
        name="chevron-down"
        size={18}
        className="text-ink-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
      />
    </div>
  );
}
