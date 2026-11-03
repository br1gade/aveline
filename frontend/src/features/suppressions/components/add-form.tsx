import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AppForm,
  SubmitButton,
  TextInputField,
  WRAPPING_BUTTON,
  type PageActions,
} from '@/ui/app-form';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { addSuppression } from '../api';
import { findListed, suppressionRefusalOf, type SuppressionRefusal } from '../rules';
import { suppressionSchema, type SuppressionFieldCode, type SuppressionValues } from '../schemas';
import { HOST_CHANNELS, type HostChannel, type Suppression } from '../types';
import { SuppressionProblem } from './shared';

const EMPTY: SuppressionValues = { channel: 'EMAIL', address: '' };

function isHostChannel(value: string): value is HostChannel {
  return (HOST_CHANNELS as readonly string[]).includes(value);
}

function ChannelChoices({
  value,
  onChange,
}: {
  value: HostChannel;
  onChange: (channel: HostChannel) => void;
}) {
  const { t } = useTranslation('suppressions');
  const id = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend id={`${id}-legend`} className="mb-1 p-0 text-sm font-medium">
        {t('add.channel')}
      </legend>
      <RadioGroup
        aria-labelledby={`${id}-legend`}
        value={value}
        onValueChange={(next) => isHostChannel(next) && onChange(next)}
        className="gap-1"
      >
        {HOST_CHANNELS.map((channel) => (
          <div key={channel} className="flex min-h-11 items-center gap-3">
            <RadioGroupItem value={channel} id={`${id}-${channel}`} />
            <Label htmlFor={`${id}-${channel}`} className="font-normal">
              {t(`channel.${channel}`)}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}

/** Adds an address, unless the list shows it on that channel already (design PD-115). */
function useAdd(list: readonly Suppression[], page: PageActions) {
  const { t } = useTranslation('suppressions');
  const [refusal, setRefusal] = useState<SuppressionRefusal | null>(null);
  const [listed, setListed] = useState<Suppression | null>(null);
  const form = useForm<SuppressionValues>({
    resolver: zodResolver(suppressionSchema),
    defaultValues: EMPTY,
  });
  const onSubmit = async (values: SuppressionValues) => {
    setRefusal(null);
    const already = findListed(list, values.channel, values.address) ?? null;
    setListed(already);
    if (already) return;
    try {
      await addSuppression(browserSession().api, values);
      form.reset(EMPTY);
      await page.done(t('status.added', { address: values.address }));
    } catch (error) {
      const found = suppressionRefusalOf(error);
      if (found.kind === 'addressRefused') form.setError('address', { message: 'refused' });
      else setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  return { form, refusal, listed, onSubmit };
}

/**
 * Adding someone who must not be contacted (design PD-114). No reason is asked: the backend records
 * the host's own as `MANUAL`. A phone matches only as typed (FR-99), which the help says.
 */
export function AddForm({ list, page }: { list: readonly Suppression[]; page: PageActions }) {
  const { t } = useTranslation('suppressions');
  const headingId = useId();
  const { form, refusal, listed, onSubmit } = useAdd(list, page);
  const { errors, isSubmitting } = form.formState;
  const code = errors.address?.message as SuppressionFieldCode | 'refused' | undefined;
  const channel = form.watch('channel');
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('add.title')}
      </h2>
      {refusal ? <SuppressionProblem refusal={refusal} /> : null}
      {listed ? (
        <p role="status" className="m-0">
          {t('add.already', { address: listed.address })}
        </p>
      ) : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <Controller
          control={form.control}
          name="channel"
          render={({ field }) => <ChannelChoices value={field.value} onChange={field.onChange} />}
        />
        <TextInputField
          label={t('add.address')}
          help={t(channel === 'EMAIL' ? 'add.emailHelp' : 'add.phoneHelp')}
          type={channel === 'EMAIL' ? 'email' : 'tel'}
          autoComplete="off"
          error={code ? t(`add.errors.${code}`) : undefined}
          {...form.register('address')}
        />
        <SubmitButton
          isSubmitting={isSubmitting}
          className={`w-auto self-start ${WRAPPING_BUTTON}`}
        >
          {isSubmitting ? t('add.adding') : t('add.submit')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
