import type { ComponentProps, ReactNode } from 'react';

import { Icon } from '../icon';

interface ChipProps extends Omit<ComponentProps<'input'>, 'type' | 'className'> {
  label: ReactNode;
}

/** A checkbox drawn as a chip, for multiple choice: dietary needs, a host's multi-choice question. */
export function Chip({ label, ...input }: ChipProps) {
  return (
    <label className="border-control-edge bg-porcelain text-ink hover:border-action hover:bg-linen has-checked:border-action has-checked:bg-action has-checked:text-action-text has-focus-visible:outline-focus has-disabled:bg-sand has-disabled:border-sand has-disabled:text-ink-muted relative inline-flex min-h-(--target-min) cursor-pointer items-center gap-2 border px-4 text-[15px] leading-5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-disabled:cursor-not-allowed">
      <input type="checkbox" className="peer sr-only" {...input} />
      <Icon name="check" size={16} className="hidden peer-checked:block" />
      {label}
    </label>
  );
}
