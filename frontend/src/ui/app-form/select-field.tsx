import { useId, type ComponentProps } from 'react';

import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { NativeSelect } from '@/ui/kit/native-select';

import { ErrorLine } from './error-line';

interface SelectFieldProps extends Omit<ComponentProps<typeof NativeSelect>, 'id'> {
  label: string;
  /** The label's language, when it isn't the page's: a host's question, say. */
  labelLang?: string | undefined;
  help?: string | undefined;
  error?: string | undefined;
}

/** A labelled native select whose help and error are tied to it, as `TextInputField` does. */
export function SelectField({
  label,
  labelLang,
  help,
  error,
  children,
  ...select
}: SelectFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ');

  return (
    <Field data-invalid={error ? 'true' : undefined} className="gap-2">
      <FieldLabel htmlFor={id} lang={labelLang}>
        {label}
      </FieldLabel>
      <NativeSelect
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...select}
      >
        {children}
      </NativeSelect>
      {help ? <FieldDescription id={helpId}>{help}</FieldDescription> : null}
      {error ? <ErrorLine id={errorId}>{error}</ErrorLine> : null}
    </Field>
  );
}
