import { useId, type ComponentProps } from 'react';

import { Icon } from '@/ui';
import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { Input } from '@/ui/kit/input';

interface TextInputFieldProps extends Omit<ComponentProps<typeof Input>, 'id'> {
  label: string;
  help?: string | undefined;
  error?: string | undefined;
}

/** A labelled input whose help and error are tied to it; an error has an icon and words. */
export function TextInputField({ label, help, error, ...input }: TextInputFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ');

  return (
    <Field data-invalid={error ? 'true' : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...input}
      />
      {help ? <FieldDescription id={helpId}>{help}</FieldDescription> : null}
      {error ? (
        <p id={errorId} className="text-destructive m-0 flex items-start gap-1.5 text-sm">
          <Icon name="circle-alert" size={16} className="mt-0.5" />
          <span>{error}</span>
        </p>
      ) : null}
    </Field>
  );
}
