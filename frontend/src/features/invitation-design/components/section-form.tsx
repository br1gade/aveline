import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Loaded } from '@/api/loaded';
import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { BlockEditing } from '@/features/invitation-renderer';
import { AppForm, ErrorLine, SelectField, SubmitButton, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { updateSection } from '../api';
import { sectionFormValues, type SectionFormValues } from '../form-model';
import { languagesWithoutCopy } from '../languages';
import { designPath } from '../paths';
import { sectionEdit } from '../payload';
import { isStaleRefusal } from '../refusals';
import { sectionFormSchema } from '../schemas';
import { refusedProperties } from '../server-errors';
import type { Design, DesignBlock, LibraryItem } from '../types';
import { useFieldText } from '../use-field-text';
import { DesignRefusal, type DesignRefusalState } from './design-parts';
import { LanguageFieldset } from './language-fieldset';
import { SectionMedia } from './section-media';
import { SwatchColours } from './swatch-colours';
import { useLayoutName } from './layout-name';

interface SectionFormProps {
  design: Design;
  block: DesignBlock;
  editing: BlockEditing;
  /** The template's layouts for this section; `null` when the catalogue could not be read. */
  layouts: readonly string[] | null;
  library: Loaded<LibraryItem[]>;
  page: PageActions;
}

/** The layouts offered, and the one stored if the template no longer lists it, so it stays. */
function LayoutField({
  form,
  layouts,
}: {
  form: UseFormReturn<SectionFormValues>;
  layouts: readonly string[];
}) {
  const { t } = useTranslation('design');
  const layoutName = useLayoutName();
  const fieldText = useFieldText();
  const current = form.getValues('variant');
  const offered = current && !layouts.includes(current) ? [...layouts, current] : layouts;
  return (
    <SelectField
      label={t('section.layout')}
      help={t('section.layoutHelp')}
      error={fieldText(form.formState.errors.variant)}
      {...form.register('variant')}
    >
      <NativeSelectOption value="">{t('section.defaultLayout')}</NativeSelectOption>
      {offered.map((layout) => {
        const { label, lang } = layoutName(layout);
        return (
          <NativeSelectOption key={layout} value={layout} lang={lang}>
            {label}
          </NativeSelectOption>
        );
      })}
    </SelectField>
  );
}

/** A 400's properties onto the fields that show them; copy and the rest are the general message. */
function markRefusals(error: unknown, form: UseFormReturn<SectionFormValues>) {
  for (const property of refusedProperties(error)) {
    if (property === 'variant' || property === 'assetIds') {
      form.setError(property, { type: 'server', message: 'refused' });
    }
  }
}

function useSave(
  { design, block, editing, page }: SectionFormProps,
  form: UseFormReturn<SectionFormValues>,
) {
  const { t } = useTranslation('design');
  const [baseline, setBaseline] = useState(() =>
    sectionFormValues(block, editing, design.event.locales),
  );
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const save = async (values: SectionFormValues) => {
    setRefusal(null);
    const body = sectionEdit(block, editing, baseline, values);
    if (Object.keys(body).length === 0) return page.done(t('section.nothing'));
    try {
      await updateSection(browserSession().api, design.slug, block.type, body);
      setBaseline(values);
      form.reset(values);
      await page.done(t(design.status === 'DRAFT' ? 'section.saved' : 'section.savedLive'));
    } catch (error) {
      markRefusals(error, form);
      setRefusal({ action: 'section', problem: problemFrom(error) });
      if (isStaleRefusal('section', error)) page.reload();
    }
  };
  return { baseline, refusal, save };
}

/**
 * A section's layout, words in each of the event's languages, colours and media, saved together
 * (design PD-57). Only the languages changed are sent, each over its stored copy.
 */
export function SectionForm(props: SectionFormProps) {
  const { t } = useTranslation('design');
  const { design, block, editing, layouts, library } = props;
  const schema = useMemo(() => sectionFormSchema(editing), [editing]);
  const [initial] = useState(() => sectionFormValues(block, editing, design.event.locales));
  const form = useForm<SectionFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });
  const { refusal, save } = useSave(props, form);
  const fieldText = useFieldText();
  const withoutCopy = languagesWithoutCopy(block, design.event.locales);
  const { isSubmitting } = form.formState;
  return (
    <AppForm onSubmit={form.handleSubmit(save)} className="gap-5">
      {refusal ? <DesignRefusal refusal={refusal} /> : null}
      {layouts && layouts.length > 0 ? <LayoutField form={form} layouts={layouts} /> : null}
      {layouts === null ? (
        <p className="text-muted-foreground m-0 text-sm">{t('section.noLayouts')}</p>
      ) : null}
      {editing.fields.length > 0
        ? design.event.locales.map((locale) => (
            <LanguageFieldset
              key={locale}
              form={form}
              locale={locale}
              isDefault={locale === design.event.defaultLocale}
              editing={editing}
              hasCopy={!withoutCopy.includes(locale)}
              type={block.type}
            />
          ))
        : null}
      {editing.hasSwatches ? <SwatchColours form={form} /> : null}
      {editing.media === 'none' ? null : (
        <SectionMedia
          form={form}
          use={editing.media}
          library={library}
          shown={block.media}
          eventId={design.event.id}
          languages={design.event.locales}
          type={block.type}
        />
      )}
      {form.formState.errors.assetIds ? (
        <ErrorLine id="section-media-error">{fieldText(form.formState.errors.assetIds)}</ErrorLine>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton isSubmitting={isSubmitting} className="w-auto">
          {isSubmitting ? t('section.saving') : t('section.save')}
        </SubmitButton>
        <Button asChild variant="ghost">
          <Link to={designPath(design.event.id)}>{t('section.cancel')}</Link>
        </Button>
      </div>
    </AppForm>
  );
}
