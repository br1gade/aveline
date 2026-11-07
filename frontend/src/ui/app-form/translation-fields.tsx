import { useId, type ComponentProps } from 'react';

import { FieldDescription, FieldLegend, FieldSet } from '@/ui/kit/field';

import { ErrorLine } from './select-field';
import { TextInputField } from './text-input-field';

interface TranslatedField<Field extends string> {
  key: Field;
  /** The field's label, naming its language, so each input stands on its own when read aloud. */
  label: (languageName: string) => string;
}

interface TranslationFieldsProps<Field extends string> {
  legend: string;
  help: string;
  languages: readonly string[];
  languageName: (code: string) => string;
  fields: ReadonlyArray<TranslatedField<Field>>;
  /** The input's own props for one field in one language: React Hook Form's `register`. */
  inputProps: (language: string, field: Field) => Omit<ComponentProps<'input'>, 'id'>;
  errorOf: (language: string, field: Field) => string | undefined;
  /** A line under one language's fields, when there is something to say of it. */
  noteOf?: (language: string) => string | undefined;
  /** A refusal of the whole section, from the server. */
  error?: string | undefined;
}

/**
 * Words in each of an event's other languages (docs/API.md §6: `translations`). Each input carries
 * its language, so a screen reader says it in the right voice and the browser checks its spelling
 * in it.
 */
export function TranslationFields<Field extends string>({
  legend,
  help,
  languages,
  languageName,
  fields,
  inputProps,
  errorOf,
  noteOf,
  error,
}: TranslationFieldsProps<Field>) {
  const id = useId();
  return (
    <FieldSet className="gap-4" aria-describedby={error ? `${id}-error` : `${id}-help`}>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <FieldDescription id={`${id}-help`}>{help}</FieldDescription>
      {languages.map((language) => {
        const note = noteOf?.(language);
        return (
          <div key={language} className="flex flex-col gap-3">
            {fields.map((field) => (
              <TextInputField
                key={field.key}
                label={field.label(languageName(language))}
                lang={language}
                autoComplete="off"
                error={errorOf(language, field.key)}
                {...inputProps(language, field.key)}
              />
            ))}
            {note ? <p className="text-muted-foreground m-0 text-sm">{note}</p> : null}
          </div>
        );
      })}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </FieldSet>
  );
}
