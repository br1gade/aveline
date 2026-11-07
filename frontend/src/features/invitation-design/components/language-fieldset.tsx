import { useId } from 'react';
import { useFieldArray, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { BlockEditing, ContentField, ContentFieldKind } from '@/features/invitation-renderer';
import { ErrorLine, TextInputField } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { Textarea } from '@/ui/kit/textarea';

import type { SectionFormValues } from '../form-model';
import { useFieldText } from '../use-field-text';
import { LanguageName } from './design-parts';

type SectionForm = UseFormReturn<SectionFormValues>;

const FIELD_NAMES = [
  'title',
  'subtitle',
  'body',
  'closing',
  'url',
  'label',
  'organizer',
  'phone',
] as const;
type FieldName = (typeof FIELD_NAMES)[number];

function isFieldName(name: string): name is FieldName {
  return (FIELD_NAMES as readonly string[]).includes(name);
}

/** The hints a field needs in one block: what an empty cover title shows, and so on. */
const HELP: Readonly<
  Record<string, 'heroTitle' | 'contactTitle' | 'paragraphs' | 'musicTitle' | 'chatUrl'>
> = {
  'HERO.title': 'heroTitle',
  'CONTACT.title': 'contactTitle',
  'STORY.body': 'paragraphs',
  'MUSIC.title': 'musicTitle',
  'CHAT.url': 'chatUrl',
};

function useHelp(type: string, name: string): string | undefined {
  const { t } = useTranslation('design');
  const key = HELP[`${type}.${name}`];
  return key ? t(`help.${key}`) : undefined;
}

const INPUT_TYPE: Readonly<Record<Exclude<ContentFieldKind, 'text'>, string>> = {
  line: 'text',
  url: 'url',
  phone: 'tel',
};

interface CopyFieldProps {
  form: SectionForm;
  name: `copy.${string}`;
  field: ContentField;
  help?: string | undefined;
  error?: string | undefined;
}

/** One field in one language: a line, paragraphs, a web link or a phone number. */
function CopyField({ form, name, field, help, error }: CopyFieldProps) {
  const { t } = useTranslation('design');
  const id = useId();
  const label = isFieldName(field.name) ? t(`fields.${field.name}`) : field.name;
  if (field.kind !== 'text') {
    return (
      <TextInputField
        label={label}
        help={help}
        error={error}
        type={INPUT_TYPE[field.kind]}
        autoComplete="off"
        {...form.register(name)}
      />
    );
  }
  return (
    <Field data-invalid={error ? 'true' : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={4}
        aria-describedby={help ? `${id}-help` : undefined}
        {...form.register(name)}
      />
      {help ? <FieldDescription id={`${id}-help`}>{help}</FieldDescription> : null}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </Field>
  );
}

function HelpedField(props: Omit<CopyFieldProps, 'help'> & { type: string }) {
  const { type, ...field } = props;
  return <CopyField {...field} help={useHelp(type, props.field.name)} />;
}

/** NOTES' items in one language: each a title and a few lines, in the order guests read them. */
function NotesItems({
  form,
  locale,
  editing,
}: {
  form: SectionForm;
  locale: string;
  editing: BlockEditing;
}) {
  const { t } = useTranslation('design');
  const items = useFieldArray({ control: form.control, name: `copy.${locale}.items` });
  const empty = () => Object.fromEntries(editing.items.map(({ name }) => [name, '']));
  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {items.fields.map((item, position) => (
          <li key={item.id} className="border-border flex flex-col gap-3 border-l-2 pl-4">
            <p className="text-muted-foreground m-0 text-sm">
              {t('section.item', { number: position + 1 })}
            </p>
            {editing.items.map((field) => (
              <CopyField
                key={field.name}
                form={form}
                name={`copy.${locale}.items.${position}.${field.name}`}
                field={field}
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              className="self-start"
              onClick={() => items.remove(position)}
            >
              {t('section.removeItem', { number: position + 1 })}
            </Button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => items.append(empty())}
      >
        {t('section.addItem')}
      </Button>
    </div>
  );
}

interface LanguageFieldsetProps {
  form: SectionForm;
  locale: string;
  isDefault: boolean;
  editing: BlockEditing;
  /** Guests reading this language see the default language's copy until it has its own. */
  hasCopy: boolean;
  type: string;
}

/** One language's copy of the section, apart from the others, as the API edits it (PD-57). */
export function LanguageFieldset({
  form,
  locale,
  isDefault,
  editing,
  hasCopy,
  type,
}: LanguageFieldsetProps) {
  const { t } = useTranslation('design');
  const fieldText = useFieldText();
  const errors = form.formState.errors.copy?.[locale]?.fields;
  return (
    <fieldset className="border-border m-0 flex min-w-0 flex-col gap-4 border px-5 pt-3 pb-5">
      <legend className="px-1 text-base font-medium">
        <LanguageName code={locale} />
        {isDefault ? ` · ${t('section.defaultLanguage')}` : null}
      </legend>
      {hasCopy || isDefault ? null : (
        <p className="text-muted-foreground m-0 text-sm">{t('section.noCopy')}</p>
      )}
      {editing.fields.map((field) => (
        <HelpedField
          key={field.name}
          form={form}
          name={`copy.${locale}.fields.${field.name}`}
          field={field}
          type={type}
          error={fieldText(errors?.[field.name])}
        />
      ))}
      {editing.items.length > 0 ? (
        <NotesItems form={form} locale={locale} editing={editing} />
      ) : null}
    </fieldset>
  );
}
