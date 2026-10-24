import { useId, type ComponentProps, type ReactNode } from 'react';

import { Icon } from '@/ui';
import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { NativeSelect } from '@/ui/kit/native-select';

/** A field's error: an icon and words, never colour alone. */
export function ErrorLine({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-destructive m-0 flex items-start gap-1.5 text-sm">
      <Icon name="circle-alert" size={16} className="mt-0.5" />
      <span>{children}</span>
    </p>
  );
}

interface SelectFieldProps extends Omit<ComponentProps<typeof NativeSelect>, 'id'> {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
}

/** A labelled native select whose help and error are tied to it, as `TextInputField` does. */
export function SelectField({ label, help, error, children, ...select }: SelectFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ');

  return (
    <Field data-invalid={error ? 'true' : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
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
