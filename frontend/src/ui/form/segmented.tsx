import type { ChangeEvent } from 'react';

import { cx } from '../cx';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
}

interface SegmentedProps<V extends string> {
  /** The person's name: the group's legend. */
  legend: string;
  name: string;
  value: V | '';
  options: ReadonlyArray<SegmentOption<V>>;
  onChange: (value: V) => void;
  isDisabled?: boolean;
}

/**
 * One radio group per person, as three segments of one height (the design system's MemberStatus,
 * PD-28). A label may wrap to two centred lines rather than overflow.
 */
export function Segmented<V extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  isDisabled = false,
}: SegmentedProps<V>) {
  function select(event: ChangeEvent<HTMLInputElement>) {
    const chosen = options.find((option) => option.value === event.target.value);
    if (chosen) onChange(chosen.value);
  }
  return (
    <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" disabled={isDisabled}>
      <legend className="text-ink mb-2 p-0 text-base leading-6">{legend}</legend>
      <div className="border-control-edge bg-porcelain grid grid-cols-3 border">
        {options.map((option, index) => (
          <label
            key={option.value}
            className={cx(
              'text-ink hover:bg-linen has-checked:bg-action has-checked:text-action-text has-focus-visible:outline-focus relative flex min-h-(--target-min) cursor-pointer items-center justify-center px-2 py-1 text-center text-[13px] leading-[18px] font-medium has-focus-visible:z-10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2',
              index > 0 && 'border-control-edge border-l',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={select}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
