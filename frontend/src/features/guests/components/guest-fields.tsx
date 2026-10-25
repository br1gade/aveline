import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { isLanguage } from '@/lib/i18n';
import { SelectField, TextInputField } from '@/ui/app-form';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { NEW_HOUSEHOLD } from '../form-model';
import { MAX_SEATS, type GuestFormInput, type GuestFormValues } from '../schemas';
import { SIDES } from '../types';
import { useGuestFieldText } from '../use-field-text';
import type { SideNames } from './household-card';

export type GuestForm = UseFormReturn<GuestFormInput, unknown, GuestFormValues>;

export interface HouseholdChoice {
  id: string;
  label: string;
}

/** What the form may offer, worked out once when the dialog opens (`use-guest-options.ts`). */
export interface GuestOptions {
  /** The list came with contact details; without them the form neither shows nor sends them. */
  isContactShown: boolean;
  languages: readonly string[];
  /** "Not set" is offered only while no language is set (FR-31). */
  hasNoLanguage: boolean;
  /** `null` when the side is not asked (`offersSides`). */
  sides: SideNames | null;
  households: readonly HouseholdChoice[];
}

interface FieldsProps {
  form: GuestForm;
  options: GuestOptions;
}

function ContactFields({ form }: { form: GuestForm }) {
  const { t } = useTranslation('guests');
  const fieldText = useGuestFieldText();
  const { errors } = form.formState;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextInputField
        label={t('fields.email')}
        type="email"
        autoComplete="off"
        error={fieldText(errors.email)}
        {...form.register('email')}
      />
      <TextInputField
        label={t('fields.phone')}
        type="tel"
        autoComplete="off"
        error={fieldText(errors.phone)}
        {...form.register('phone')}
      />
    </div>
  );
}

function LanguageAndSide({ form, options }: FieldsProps) {
  const { t } = useTranslation('guests');
  const { t: common } = useTranslation('common');
  const fieldText = useGuestFieldText();
  const { errors } = form.formState;
  const { sides } = options;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label={t('fields.language')}
        error={fieldText(errors.locale)}
        {...form.register('locale')}
      >
        {options.hasNoLanguage ? (
          <NativeSelectOption value="">{t('fields.noLanguage')}</NativeSelectOption>
        ) : null}
        {options.languages.map((code) => (
          <NativeSelectOption key={code} value={code}>
            {isLanguage(code) ? common(`language.${code}`) : code}
          </NativeSelectOption>
        ))}
      </SelectField>
      {sides ? (
        <SelectField
          label={t('fields.side')}
          error={fieldText(errors.side)}
          {...form.register('side')}
        >
          {SIDES.map((side) => (
            <NativeSelectOption key={side} value={side}>
              {side === 'UNKNOWN' ? t('side.UNKNOWN') : sides[side]}
            </NativeSelectOption>
          ))}
        </SelectField>
      ) : null}
    </div>
  );
}

function HouseholdFields({ form, options, mode }: FieldsProps & { mode: 'add' | 'edit' }) {
  const { t } = useTranslation('guests');
  const fieldText = useGuestFieldText();
  const { errors } = form.formState;
  const household = useWatch({ control: form.control, name: 'household' });
  return (
    <>
      <SelectField
        label={t('fields.household')}
        help={mode === 'edit' ? t('fields.moveHelp') : undefined}
        error={fieldText(errors.household)}
        {...form.register('household')}
      >
        {mode === 'add' ? (
          <NativeSelectOption value={NEW_HOUSEHOLD}>{t('fields.newHousehold')}</NativeSelectOption>
        ) : null}
        {options.households.map((choice) => (
          <NativeSelectOption key={choice.id} value={choice.id}>
            {choice.label}
          </NativeSelectOption>
        ))}
      </SelectField>
      {mode === 'add' && household === NEW_HOUSEHOLD ? (
        <TextInputField
          label={t('fields.seats')}
          help={t('fields.seatsHelp')}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_SEATS}
          className="max-w-[8rem]"
          error={fieldText(errors.seats)}
          {...form.register('seats')}
        />
      ) : null}
    </>
  );
}

/**
 * Adding and correcting a guest (design PD-44). The household choice moves a guest when editing;
 * seats are asked only for a new household of their own.
 */
export function GuestFields({ form, options, mode }: FieldsProps & { mode: 'add' | 'edit' }) {
  const { t } = useTranslation('guests');
  const fieldText = useGuestFieldText();
  const { errors } = form.formState;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextInputField
          label={t('fields.firstName')}
          autoComplete="off"
          error={fieldText(errors.firstName)}
          {...form.register('firstName')}
        />
        <TextInputField
          label={t('fields.lastName')}
          autoComplete="off"
          error={fieldText(errors.lastName)}
          {...form.register('lastName')}
        />
      </div>
      {options.isContactShown ? <ContactFields form={form} /> : null}
      <LanguageAndSide form={form} options={options} />
      <HouseholdFields form={form} options={options} mode={mode} />
    </>
  );
}
