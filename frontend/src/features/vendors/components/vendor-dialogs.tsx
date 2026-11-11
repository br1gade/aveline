import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AppForm,
  AskFirstDialog,
  SubmitButton,
  useDialogAction,
  useLeaveGuard,
  type DialogContext,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/kit/dialog';

import { correctVendor, removeVendor } from '../api';
import { vendorChanges, vendorEditValues } from '../payload';
import { vendorRefusalOf } from '../refusals';
import { vendorFormSchema, type VendorFormOutput, type VendorFormValues } from '../schemas';
import type { Vendor } from '../types';
import { VendorProblem } from './shared';
import { markRefusedFields, VendorFields } from './vendor-fields';

interface VendorDialogProps extends DialogContext {
  vendor: Vendor;
}

/** Only what changed is sent, and an emptied detail clears it (FR-102, design PD-120). */
export function CorrectVendorDialog({ vendor, ...context }: VendorDialogProps) {
  const { t } = useTranslation('vendors');
  const form = useForm<VendorFormValues, unknown, VendorFormOutput>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: vendorEditValues(vendor),
  });
  useLeaveGuard(form);
  const action = useDialogAction(context, (error) => {
    const found = vendorRefusalOf(error, 'correct');
    if (found.kind === 'fields') markRefusedFields(form, found.fields);
    return found;
  });
  const save = (values: VendorFormOutput) => {
    const changes = vendorChanges(vendor, values);
    if (Object.keys(changes).length === 0)
      return action.run(() => Promise.resolve(), t('status.unchanged'));
    return action.run(
      async () => {
        await correctVendor(browserSession().api, vendor.id, changes);
        form.reset(values);
      },
      t('status.corrected', { name: values.name }),
    );
  };
  return (
    <Dialog open onOpenChange={action.onOpenChange}>
      <DialogContent onCloseAutoFocus={action.onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('correct.title', { name: vendor.name })}</DialogTitle>
        </DialogHeader>
        {action.refusal ? <VendorProblem refusal={action.refusal} /> : null}
        <AppForm onSubmit={form.handleSubmit(save)}>
          <VendorFields form={form} />
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              disabled={action.isBusy}
              onClick={context.onClose}
            >
              {t('correct.cancel')}
            </Button>
            <SubmitButton isSubmitting={action.isBusy} className="w-auto">
              {action.isBusy ? t('correct.saving') : t('correct.save')}
            </SubmitButton>
          </DialogFooter>
        </AppForm>
      </DialogContent>
    </Dialog>
  );
}

/** Asked first: it goes from the list and new bookings, and its bookings stay (FR-102). */
export function RemoveVendorDialog({ vendor, ...context }: VendorDialogProps) {
  const { t } = useTranslation('vendors');
  const action = useDialogAction(context, (error) => vendorRefusalOf(error, 'remove'));
  return (
    <AskFirstDialog
      onOpenChange={action.onOpenChange}
      onCloseAutoFocus={action.onCloseAutoFocus}
      title={t('remove.title', { name: vendor.name })}
      body={t('remove.body')}
      confirmLabel={t('remove.confirm')}
      isBusy={action.isBusy}
      problem={action.refusal ? <VendorProblem refusal={action.refusal} /> : null}
      onConfirm={() =>
        void action.run(
          () => removeVendor(browserSession().api, vendor.id),
          t('status.removed', { name: vendor.name }),
        )
      }
    />
  );
}
