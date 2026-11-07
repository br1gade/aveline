import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../cx';
import { Icon } from '../icon';

interface FieldFrameProps {
  label: ReactNode;
  /** "Optional", in words beside the label. */
  optionalText?: string | undefined;
  help?: ReactNode;
  error?: string | undefined;
  /** "12 / 200" under the field. */
  counter?: string | undefined;
}

const INPUT =
  'border-control-edge bg-porcelain text-ink placeholder:text-ink-muted hover:border-action focus:outline-focus focus:border-focus disabled:bg-linen disabled:text-ink-muted disabled:border-sand box-border w-full rounded-none border px-4 py-3 text-base leading-6 focus:outline-2 focus:outline-offset-0';

function useFieldIds(id: string | undefined) {
  const generated = useId();
  const fieldId = id ?? generated;
  return { fieldId, helpId: `${fieldId}-help`, errorId: `${fieldId}-error` };
}

function describedBy(ids: ReturnType<typeof useFieldIds>, frame: FieldFrameProps) {
  return (
    [frame.help ? ids.helpId : '', frame.error ? ids.errorId : ''].filter(Boolean).join(' ') ||
    undefined
  );
}

function Frame({
  ids,
  frame,
  children,
}: {
  ids: ReturnType<typeof useFieldIds>;
  frame: FieldFrameProps;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={ids.fieldId} className="text-ink text-sm leading-5 font-medium">
        {frame.label}
        {frame.optionalText ? (
          <span className="text-ink-muted font-normal"> · {frame.optionalText}</span>
        ) : null}
      </label>
      {children}
      {frame.help ? (
        <p id={ids.helpId} className="text-ink-muted m-0 text-sm leading-5">
          {frame.help}
        </p>
      ) : null}
      {frame.error ? (
        <p id={ids.errorId} className="text-error m-0 flex items-start gap-2 text-sm leading-5">
          <Icon name="circle-alert" size={18} className="mt-px" />
          {frame.error}
        </p>
      ) : null}
      {frame.counter ? (
        <p className="text-ink-muted m-0 text-right text-xs leading-[18px]">{frame.counter}</p>
      ) : null}
    </div>
  );
}

type TextFieldProps = FieldFrameProps & Omit<ComponentProps<'input'>, 'className'>;

/** A labelled text field: 48 px tall, 16 px text so iOS does not zoom (DESIGN_SYSTEM §3.2). */
export function TextField({
  label,
  optionalText,
  help,
  error,
  counter,
  id,
  ...input
}: TextFieldProps) {
  const ids = useFieldIds(id);
  const frame = { label, optionalText, help, error, counter };
  return (
    <Frame ids={ids} frame={frame}>
      <input
        id={ids.fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, frame)}
        className={cx(INPUT, 'min-h-(--control-height)', error && 'border-error')}
        {...input}
      />
    </Frame>
  );
}

type TextAreaProps = FieldFrameProps & Omit<ComponentProps<'textarea'>, 'className'>;

export function TextArea({
  label,
  optionalText,
  help,
  error,
  counter,
  id,
  ...input
}: TextAreaProps) {
  const ids = useFieldIds(id);
  const frame = { label, optionalText, help, error, counter };
  return (
    <Frame ids={ids} frame={frame}>
      <textarea
        id={ids.fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, frame)}
        className={cx(INPUT, 'min-h-28 resize-y', error && 'border-error')}
        {...input}
      />
    </Frame>
  );
}
