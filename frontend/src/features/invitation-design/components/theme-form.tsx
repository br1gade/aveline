import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import { AppForm, ErrorLine, SelectField, SubmitButton, type PageActions } from '@/ui/app-form';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { updateTheme } from '../api';
import { themeFormValues, type ThemeValues } from '../form-model';
import { themeEdit } from '../payload';
import { isStaleRefusal } from '../refusals';
import { refusedProperties } from '../server-errors';
import type { Design, Palette } from '../types';
import { useFieldText } from '../use-field-text';
import { DesignRefusal, type DesignRefusalState } from './design-parts';

type ThemeForm = UseFormReturn<ThemeValues>;
type FontField = 'headingFont' | 'bodyFont';

/** The template's fonts only; one stored that it no longer offers stays, marked, so it is seen. */
function FontSelect({
  form,
  field,
  fonts,
}: {
  form: ThemeForm;
  field: FontField;
  fonts: readonly string[];
}) {
  const { t } = useTranslation('design');
  const fieldText = useFieldText();
  const current = form.getValues(field);
  return (
    <SelectField
      label={t(`look.${field}`)}
      error={fieldText(form.formState.errors[field])}
      {...form.register(field)}
    >
      {current === '' ? (
        <NativeSelectOption value="">{t('look.templateChoice')}</NativeSelectOption>
      ) : null}
      {current && !fonts.includes(current) ? (
        <NativeSelectOption value={current}>
          {t('look.notOffered', { name: current })}
        </NativeSelectOption>
      ) : null}
      {fonts.map((font) => (
        <NativeSelectOption key={font} value={font}>
          {font}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

/** A palette's colours as small squares: the template names no roles for them (BQ-2). */
export function PaletteSwatches({ palette }: { palette: Palette }) {
  return (
    <span className="flex flex-wrap gap-1" aria-hidden="true">
      {palette.colors.map((colour, position) => (
        <span
          key={position}
          className="border-border inline-block size-5 border"
          style={{ backgroundColor: colour }}
        />
      ))}
    </span>
  );
}

function PaletteChoice({ form, palettes }: { form: ThemeForm; palettes: readonly Palette[] }) {
  const { t } = useTranslation('design');
  const fieldText = useFieldText();
  const error = fieldText(form.formState.errors.palette);
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 text-sm font-medium">{t('look.palette')}</legend>
      {palettes.map((palette) => (
        <label
          key={palette.name}
          className="border-input has-[:checked]:border-primary has-[:checked]:bg-accent flex min-h-11 cursor-pointer flex-wrap items-center gap-3 border px-3 py-2"
        >
          <input
            type="radio"
            value={palette.name}
            className="accent-primary size-4"
            {...form.register('palette')}
          />
          <span>{palette.name}</span>
          <PaletteSwatches palette={palette} />
        </label>
      ))}
      {error ? <ErrorLine id="look-palette-error">{error}</ErrorLine> : null}
    </fieldset>
  );
}

const THEME_FIELDS: readonly string[] = ['headingFont', 'bodyFont', 'palette'];

/**
 * The current template's look (design PD-58): its fonts and palettes only, which the backend
 * enforces. Only what changed is sent; a refusal names every problem at once, each on its field.
 */
export function ThemeForm({ design, page }: { design: Design; page: PageActions }) {
  const { t } = useTranslation('design');
  const [baseline, setBaseline] = useState(() => themeFormValues(design.effectiveTheme));
  const form = useForm<ThemeValues>({ defaultValues: baseline });
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const save = async (values: ThemeValues) => {
    setRefusal(null);
    const body = themeEdit(baseline, values);
    if (Object.keys(body).length === 0) return page.done(t('look.nothing'));
    try {
      await updateTheme(browserSession().api, design.slug, body);
      setBaseline(values);
      form.reset(values);
      await page.done(t('look.saved'));
    } catch (error) {
      for (const property of refusedProperties(error)) {
        if (THEME_FIELDS.includes(property)) {
          form.setError(property as keyof ThemeValues, { type: 'server', message: 'refused' });
        }
      }
      setRefusal({ action: 'theme', problem: problemFrom(error) });
      if (isStaleRefusal('theme', error)) page.reload();
    }
  };
  const { template } = design;
  return (
    <AppForm onSubmit={form.handleSubmit(save)} className="max-w-[30rem] gap-5">
      {refusal ? <DesignRefusal refusal={refusal} /> : null}
      <FontSelect form={form} field="headingFont" fonts={template.allowedFonts} />
      <FontSelect form={form} field="bodyFont" fonts={template.allowedFonts} />
      {template.palettes.length > 0 ? (
        <PaletteChoice form={form} palettes={template.palettes} />
      ) : null}
      <SubmitButton isSubmitting={form.formState.isSubmitting} className="w-auto self-start">
        {form.formState.isSubmitting ? t('look.saving') : t('look.save')}
      </SubmitButton>
    </AppForm>
  );
}
