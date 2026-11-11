import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { LibraryItem } from '@/features/invitation-design';
import { ChangeableWith } from '@/features/permissions';
import { AppForm, ProblemAlert, SubmitButton, TextInputField, useLeaveGuard } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { NativeSelect, NativeSelectOption } from '@/ui/kit/native-select';
import { Textarea } from '@/ui/kit/textarea';

import { saveListing } from '../api';
import {
  announcementFormValues,
  languagesWithStored,
  type AnnouncementFormValues,
} from '../form-model';
import type { AnnouncementData } from '../load';
import { publicEventPath, ticketSalesPath } from '../paths';
import { announcementBody } from '../payload';
import { inLanguage } from '../read';
import { announcementSchema } from '../schemas';
import { LINK } from './shared';
import { eventLanguages, useFormText, useLanguageLabel } from './use-form-text';

type Form = UseFormReturn<AnnouncementFormValues>;

function LongText({
  form,
  name,
  label,
}: {
  form: Form;
  name: `copy.${string}.${'summary' | 'body' | 'ogDescription'}`;
  label: string;
}) {
  const id = name.replaceAll('.', '-');
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} rows={4} {...form.register(name)} />
    </Field>
  );
}

/** One language's words: the headline and summary buyers read first, the body, and the share copy. */
function LanguageCopy({ form, language, label }: { form: Form; language: string; label: string }) {
  const { t } = useTranslation('ticket-sales');
  const at = (field: string) => `copy.${language}.${field}` as const;
  return (
    <FieldSet className="gap-3" lang={language}>
      <FieldLegend>{label}</FieldLegend>
      <TextInputField
        label={t('announcementForm.headline')}
        {...form.register(at('headline') as `copy.${string}.headline`)}
      />
      <LongText
        form={form}
        name={at('summary') as `copy.${string}.summary`}
        label={t('announcementForm.summary')}
      />
      <LongText
        form={form}
        name={at('body') as `copy.${string}.body`}
        label={t('announcementForm.body')}
      />
      <TextInputField
        label={t('announcementForm.ogTitle')}
        help={t('announcementForm.ogTitleHelp')}
        {...form.register(at('ogTitle') as `copy.${string}.ogTitle`)}
      />
      <LongText
        form={form}
        name={at('ogDescription') as `copy.${string}.ogDescription`}
        label={t('announcementForm.ogDescription')}
      />
    </FieldSet>
  );
}

function PictureChoice({
  form,
  name,
  pictures,
  data,
}: {
  form: Form;
  name: 'heroAssetId' | 'ogImageId';
  pictures: LibraryItem[];
  data: AnnouncementData;
}) {
  const { t, i18n } = useTranslation('ticket-sales');
  const text = useFormText();
  const chosen = useWatch({ control: form.control, name });
  const item = pictures.find((picture) => picture.id === chosen);
  const id = `announcement-${name}`;
  const error = text(form.formState.errors[name]?.message);
  const nameOf = (picture: LibraryItem) =>
    inLanguage(picture.altText, i18n.language, data.event.defaultLocale) ??
    t('announcementForm.untitledPicture', {
      kind: t(`announcementForm.kinds.${picture.kind as 'PHOTO'}`, { defaultValue: picture.kind }),
      date: picture.createdAt.slice(0, 10),
    });
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id}>{t(`announcementForm.${name}`)}</FieldLabel>
      <NativeSelect id={id} aria-invalid={error ? true : undefined} {...form.register(name)}>
        <NativeSelectOption value="">
          {t(name === 'heroAssetId' ? 'announcementForm.noPicture' : 'announcementForm.sameAsHero')}
        </NativeSelectOption>
        {pictures.map((picture) => (
          <NativeSelectOption key={picture.id} value={picture.id}>
            {nameOf(picture)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {item ? (
        <img
          src={item.variants[0]?.url ?? item.url}
          alt=""
          className="border-border h-24 w-auto self-start border object-cover"
        />
      ) : null}
      {error ? <p className="text-destructive m-0 text-sm">{error}</p> : null}
    </Field>
  );
}

function Settings({ form, data }: { form: Form; data: AnnouncementData }) {
  const { t } = useTranslation('ticket-sales');
  const text = useFormText();
  const { errors } = form.formState;
  const slug = useWatch({ control: form.control, name: 'slug' });
  return (
    <>
      <TextInputField
        label={t('announcementForm.categories')}
        help={t('announcementForm.categoriesHelp')}
        error={text(errors.categories?.message)}
        {...form.register('categories')}
      />
      <TextInputField
        label={t('announcementForm.slug')}
        help={t('announcementForm.slugHelp', { path: publicEventPath(slug.trim() || '…') })}
        error={text(errors.slug?.message)}
        {...form.register('slug')}
      />
      <TextInputField
        inputMode="numeric"
        label={t('announcementForm.buyerTicketLimit')}
        help={t('announcementForm.buyerTicketLimitHelp')}
        error={text(errors.buyerTicketLimit?.message)}
        {...form.register('buyerTicketLimit')}
      />
      <PictureChoice form={form} name="heroAssetId" pictures={data.pictures} data={data} />
      <PictureChoice form={form} name="ogImageId" pictures={data.pictures} data={data} />
      <Controller
        control={form.control}
        name="isIndexable"
        render={({ field }) => (
          <div className="flex items-start gap-3">
            <Checkbox
              id="announcement-indexable"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              aria-describedby="announcement-indexable-help"
              className="mt-1"
            />
            <div className="flex flex-col">
              <Label htmlFor="announcement-indexable" className="font-normal">
                {t('announcementForm.indexable')}
              </Label>
              <FieldDescription id="announcement-indexable-help">
                {t('announcementForm.indexableHelp')}
              </FieldDescription>
            </div>
          </div>
        )}
      />
    </>
  );
}

/** A taken address and a picture that is not the event's are said on their fields. */
function markRefusal(form: Form, error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.status === 409) form.setError('slug', { message: 'slugTaken' });
  else if (
    error.status === 400 &&
    error.messages.some((message) => message.startsWith('heroAssetId/ogImageId:'))
  )
    form.setError('heroAssetId', { message: 'images' });
  else return false;
  return true;
}

/** The event's languages, then any other the stored announcement still holds words in. */
function announcementLanguages({ event, listing }: AnnouncementData): string[] {
  const stored = listing
    ? [listing.headline, listing.summary, listing.body, listing.ogTitle, listing.ogDescription]
    : [];
  return languagesWithStored(eventLanguages(event), ...stored);
}

function FormFooter({ isSubmitting, eventId }: { isSubmitting: boolean; eventId: string }) {
  const { t } = useTranslation('ticket-sales');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SubmitButton isSubmitting={isSubmitting} className="w-auto">
        {t('announcementForm.save')}
      </SubmitButton>
      <Button asChild variant="ghost">
        <Link to={ticketSalesPath(eventId)}>{t('cancel')}</Link>
      </Button>
    </div>
  );
}

/**
 * Writing the announcement (design PD-86), a page as a designer section is (PD-57): the words in
 * each of the event's languages, categories, its address, its pictures, and whether search engines
 * may find it. A save sends only what changed; a picture cleared is sent as `null`.
 */
export function AnnouncementForm({ data }: { data: AnnouncementData }) {
  const { t } = useTranslation('ticket-sales');
  const navigate = useNavigate();
  const { event, listing } = data;
  const [languages] = useState(() => announcementLanguages(data));
  const labelOf = useLanguageLabel(event);
  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementSchema()),
    defaultValues: announcementFormValues(listing, languages),
  });
  useLeaveGuard(form);
  const [problem, setProblem] = useState<Problem | null>(null);
  const onSubmit = async (values: AnnouncementFormValues) => {
    setProblem(null);
    const body = announcementBody(listing, values, languages);
    try {
      if (!listing || Object.keys(body).length > 0)
        await saveListing(browserSession().api, event.id, body);
      await navigate(ticketSalesPath(event.id));
    } catch (error) {
      if (!markRefusal(form, error)) setProblem(problemFrom(error));
    }
  };
  return (
    <section className="flex max-w-[40rem] flex-col gap-5">
      <Link to={ticketSalesPath(event.id)} className={LINK}>
        {t('typeForm.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {t('announcementForm.title')}
        </h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0">{t('announcementForm.lead')}</p>
      {problem ? (
        <ProblemAlert
          problem={problem}
          refused={(status) => t(status === 403 ? 'forbidden' : 'refused')}
        />
      ) : null}
      <ChangeableWith to="event:write" readOnly={t('forbidden')}>
        <AppForm onSubmit={form.handleSubmit(onSubmit)} className="gap-6">
          {languages.map((language) => (
            <LanguageCopy
              key={language}
              form={form}
              language={language}
              label={labelOf(language)}
            />
          ))}
          <Settings form={form} data={data} />
          <FormFooter isSubmitting={form.formState.isSubmitting} eventId={event.id} />
        </AppForm>
      </ChangeableWith>
    </section>
  );
}
