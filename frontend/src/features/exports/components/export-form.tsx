import { useId, type RefObject } from 'react';
import { Controller, type Control, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AppForm, SelectField, SubmitButton } from '@/ui/app-form';
import { FieldDescription, FieldLegend, FieldSet } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { contactRuleOf, intentOf } from '../intent';
import { FILE_LANGUAGES } from '../languages';
import type { ExportValues } from '../schemas';
import { EXPORT_FORMATS, EXPORT_KINDS, type ExportKind } from '../types';
import { ExportProblem, PANEL, WRAP } from './shared';
import type { ExportText } from './use-export-text';
import { AT_FORM, type Exports } from './use-exports';

interface ChoiceProps {
  control: Control<ExportValues>;
}

interface Option {
  value: string;
  name: string;
  about: string;
}

/** A radio per option, each with a line saying what it is, tied to it for screen readers. */
function Options({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <RadioGroup value={value} onValueChange={onChange} className="gap-2">
      {options.map((option) => (
        <div key={option.value} className="flex min-h-11 items-start gap-3">
          <RadioGroupItem
            value={option.value}
            id={`${id}-${option.value}`}
            aria-describedby={`${id}-${option.value}-about`}
            className="mt-1"
          />
          <div className="flex min-w-0 flex-col">
            <Label htmlFor={`${id}-${option.value}`} className="font-normal">
              {option.name}
            </Label>
            <span id={`${id}-${option.value}-about`} className="text-muted-foreground text-sm">
              {option.about}
            </span>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}

function KindChoice({ control }: ChoiceProps) {
  const { t } = useTranslation('exports');
  const options = EXPORT_KINDS.map((kind) => ({
    value: kind,
    name: t(`kinds.${kind}.name`),
    about: t(`kinds.${kind}.about`),
  }));
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('form.kind')}</FieldLegend>
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <Options options={options} value={field.value} onChange={field.onChange} />
        )}
      />
    </FieldSet>
  );
}

function FormatChoice({ control }: ChoiceProps) {
  const { t } = useTranslation('exports');
  const options = EXPORT_FORMATS.map((format) => ({
    value: format,
    name: t(`formats.${format}.name`),
    about: t(`formats.${format}.about`),
  }));
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('form.format')}</FieldLegend>
      <Controller
        control={control}
        name="format"
        render={({ field }) => (
          <Options options={options} value={field.value} onChange={field.onChange} />
        )}
      />
    </FieldSet>
  );
}

/**
 * Asked only for the guest list, the one kind with email and phone columns; a ticket manifest
 * always has them (FR-60's stand-in, `intent.ts`).
 */
function ContactsChoice({ control, kind }: ChoiceProps & { kind: ExportKind }) {
  const { t } = useTranslation('exports');
  const id = useId();
  const rule = contactRuleOf(kind);
  if (rule === 'none') return null;
  if (rule === 'required') {
    return (
      <div className="flex flex-col gap-1">
        <p className="m-0 text-sm font-medium">{t('form.contacts')}</p>
        <p className="text-muted-foreground m-0 text-sm">{t('form.manifest')}</p>
      </div>
    );
  }
  return (
    <FieldSet className="gap-3" aria-describedby={`${id}-help`}>
      <FieldLegend variant="label">{t('form.contacts')}</FieldLegend>
      <FieldDescription id={`${id}-help`}>{t('form.contactsHelp')}</FieldDescription>
      <Controller
        control={control}
        name="withContacts"
        render={({ field }) => (
          <RadioGroup
            value={field.value ? 'with' : 'without'}
            onValueChange={(value) => field.onChange(value === 'with')}
            className="gap-1"
          >
            {(['with', 'without'] as const).map((value) => (
              <div key={value} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={value} id={`${id}-${value}`} />
                <Label htmlFor={`${id}-${value}`} className="font-normal">
                  {t(value === 'with' ? 'form.withContacts' : 'form.withoutContacts')}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      />
    </FieldSet>
  );
}

interface ExportFormProps {
  form: UseFormReturn<ExportValues>;
  exports: Exports;
  text: ExportText;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

/**
 * Making an export (design PD-74): what, in which format and language, and, for the guest list,
 * whether with email and phone. Posts from JavaScript; the press is disabled until the page is
 * hydrated (PD-41) and while an export is being asked for.
 */
export function ExportForm({ form, exports, text, headingRef }: ExportFormProps) {
  const { t } = useTranslation('exports');
  const kind = form.watch('kind');
  const placed = exports.refusal?.at === AT_FORM ? exports.refusal : null;
  const onSubmit = form.handleSubmit((values) => exports.create(intentOf(values), AT_FORM));
  return (
    <section aria-labelledby="exports-form" className={PANEL}>
      <h2
        id="exports-form"
        ref={headingRef}
        tabIndex={-1}
        className="m-0 text-lg font-medium outline-none"
      >
        {t('form.title')}
      </h2>
      <AppForm onSubmit={onSubmit} className="gap-6">
        <KindChoice control={form.control} />
        <FormatChoice control={form.control} />
        <SelectField
          label={t('form.language')}
          help={t('form.languageHelp')}
          {...form.register('locale')}
        >
          {FILE_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {text.language(language)}
            </option>
          ))}
        </SelectField>
        <ContactsChoice control={form.control} kind={kind} />
        {placed ? <ExportProblem placed={placed} exports={exports} /> : null}
        <SubmitButton
          isSubmitting={exports.creatingAt !== null}
          className={`w-auto self-start ${WRAP}`}
        >
          {exports.creatingAt === AT_FORM ? t('form.submitting') : t('form.submit')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
