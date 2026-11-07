import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { formatMinor } from '@/lib/money';
import { WordedRefusal } from '@/ui/app-form';

import type { VendorRefusal } from '../refusals';
import type { VendorFieldCode } from '../schemas';
import type { BriefSection, Fee, VendorCategory } from '../types';

const BACK_LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

/** A refusal in our words (FR-6: every action offered, a 403 worded for the action pressed). */
export function VendorProblem({ refusal }: { refusal: VendorRefusal }) {
  const { t } = useTranslation('vendors');
  const message =
    refusal.kind === 'forbidden'
      ? t(`refused.forbidden.${refusal.action}`)
      : t(`refused.${refusal.kind}`);
  return (
    <WordedRefusal
      message={message}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

const FIELD_CODES: readonly string[] = [
  'required',
  'nameShort',
  'tooLong',
  'email',
  'fee',
  'feeTooLarge',
  'cantClear',
] satisfies VendorFieldCode[];

function isFieldCode(code: string): code is VendorFieldCode {
  return FIELD_CODES.includes(code);
}

/** A field's error: the form's own code, or the server's refusal of that field (`refused`). */
export function useFieldText() {
  const { t } = useTranslation('vendors');
  return (error: { message?: unknown } | undefined) => {
    const code = error?.message;
    if (typeof code !== 'string') return undefined;
    return isFieldCode(code) ? t(`errors.${code}`) : t('errors.refused');
  };
}

export function useCategoryText() {
  const { t } = useTranslation('vendors');
  return (category: VendorCategory) => t(`categories.${category}`);
}

/** The sections a brief shares, in words, in the backend's order. */
export function useSectionsText() {
  const { t } = useTranslation('vendors');
  return (sections: readonly BriefSection[]) =>
    sections.length === 0
      ? t('scopes.noneShort')
      : sections.map((section) => t(`scopes.${section}.label`)).join(t('listSeparator'));
}

/** "Not yours to see" for a role without `vendor:fee:read`, never an empty fee (FR-6). */
export function useFeeText() {
  const { t, i18n } = useTranslation('vendors');
  return (fee: Fee) => {
    if (!fee.isShown) return t('fee.hidden');
    if (fee.amountMinor === null) return t('fee.none');
    return t('fee.amount', { amount: formatMinor(fee.amountMinor, fee.currency, i18n.language) });
  };
}

export function PageHeading({
  back,
  backLabel,
  title,
  subtitle,
}: {
  back: string;
  backLabel: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <>
      <Link to={back} className={BACK_LINK}>
        {backLabel}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal break-words">
          {title}
        </h1>
        {subtitle ? <p className="text-muted-foreground m-0">{subtitle}</p> : null}
      </div>
    </>
  );
}

/** A label and its value, the value allowed to wrap anywhere (an address, a long name). */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="m-0 break-words">{children}</dd>
    </div>
  );
}

export { BACK_LINK };
