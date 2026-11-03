import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AppForm,
  SubmitButton,
  TextInputField,
  useDialogAction,
  WRAPPING_BUTTON,
  type DialogContext,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import { updatePromoCode } from '../api';
import { limitsFormValues, limitsPayload } from '../payload';
import { promoRefusalOf } from '../rules';
import { limitsFormSchema, type LimitsFormValues } from '../schemas';
import type { PromoCode } from '../types';
import { useFieldText } from './create-form';
import { PromoProblem } from './shared';

function LimitsFields({
  form,
  promo,
  zone,
}: {
  form: UseFormReturn<LimitsFormValues>;
  promo: PromoCode;
  zone: string;
}) {
  const { t } = useTranslation('promo-codes');
  const fieldText = useFieldText();
  const { errors } = form.formState;
  return (
    <>
      <TextInputField
        label={t('create.limit')}
        help={t('limits.used', { count: promo.redemptions })}
        inputMode="numeric"
        autoComplete="off"
        error={fieldText(errors.maxRedemptions)}
        {...form.register('maxRedemptions')}
      />
      <p className="text-muted-foreground m-0 text-sm">
        {t('create.zoneHelp', { timeZone: zone.replaceAll('_', ' ') })}
      </p>
      <div className="grid gap-5 min-[480px]:grid-cols-2">
        <TextInputField
          type="date"
          max="9999-12-31"
          label={t('limits.untilDate')}
          error={fieldText(errors.untilDate)}
          {...form.register('untilDate')}
        />
        <TextInputField
          type="time"
          label={t('limits.untilTime')}
          error={fieldText(errors.untilTime)}
          {...form.register('untilTime')}
        />
      </div>
    </>
  );
}

interface LimitsDialogProps extends DialogContext {
  promo: PromoCode;
  zone: string;
}

/**
 * Correcting a code's limit and its end, the two things the API lets change (FR-100). It can't be
 * dismissed while it saves, and a correction that changed nothing closes without a request.
 */
export function LimitsDialog({ promo, zone, ...context }: LimitsDialogProps) {
  const { t } = useTranslation('promo-codes');
  const [initial] = useState(() => limitsFormValues(promo, zone));
  const form = useForm<LimitsFormValues>({
    resolver: zodResolver(limitsFormSchema(promo, zone)),
    defaultValues: initial,
  });
  const action = useDialogAction(context, promoRefusalOf);
  const save = async (values: LimitsFormValues) => {
    const body = limitsPayload(initial, values, zone);
    if (Object.keys(body).length === 0) return context.onClose();
    return action.run(
      () => updatePromoCode(browserSession().api, promo.id, body),
      t('status.saved', { code: promo.code }),
    );
  };
  return (
    <Dialog open onOpenChange={action.onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[30rem]"
        onCloseAutoFocus={action.onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('limits.title', { code: promo.code })}</DialogTitle>
          <DialogDescription>{t('limits.body')}</DialogDescription>
        </DialogHeader>
        {action.refusal ? <PromoProblem refusal={action.refusal} /> : null}
        <AppForm onSubmit={form.handleSubmit(save)}>
          <LimitsFields form={form} promo={promo} zone={zone} />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className={WRAPPING_BUTTON}
              disabled={action.isBusy}
              onClick={context.onClose}
            >
              {t('dialog.cancel')}
            </Button>
            <SubmitButton isSubmitting={action.isBusy} className={`w-auto ${WRAPPING_BUTTON}`}>
              {action.isBusy ? t('dialog.saving') : t('limits.save')}
            </SubmitButton>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}
