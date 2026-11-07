import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../cx';
import { Icon } from '../icon';

interface ChoiceCardProps extends Omit<ComponentProps<'input'>, 'type' | 'className'> {
  label: ReactNode;
  /** An optional line under the label. */
  hint?: ReactNode;
}

/**
 * A real radio button drawn as a card (DESIGN_SYSTEM §9, PD-33): its own round mark, a 2 px
 * `action` edge, the `selected` ground and a check when chosen, 56 px tall. Single choice only;
 * chips are for multiple choice (PD-32).
 */
export function ChoiceCard({ label, hint, ...input }: ChoiceCardProps) {
  return (
    <label
      className={cx(
        'border-control-edge bg-porcelain text-ink relative flex min-h-14 cursor-pointer items-center gap-3 border px-4 py-3',
        'hover:border-action',
        'has-checked:border-action has-checked:bg-selected has-checked:border-2 has-checked:px-[15px] has-checked:py-[11px]',
        'has-focus-visible:outline-focus has-focus-visible:outline-2 has-focus-visible:outline-offset-2',
        'has-disabled:bg-linen has-disabled:text-ink-muted has-disabled:border-sand has-disabled:cursor-not-allowed',
      )}
    >
      <input type="radio" className="peer sr-only" {...input} />
      <span
        aria-hidden="true"
        className="border-control-edge bg-porcelain peer-checked:border-action peer-checked:after:bg-action grid size-5 flex-none place-items-center rounded-full border after:size-2.5 after:rounded-full after:content-['']"
      />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint ? <span className="text-ink-muted text-sm leading-5">{hint}</span> : null}
      </span>
      <Icon name="check" className="text-action invisible ml-auto peer-checked:visible" />
    </label>
  );
}
