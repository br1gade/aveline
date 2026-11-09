import { useMemo, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { PublicFrame } from '@/features/public-event';
import { createI18n, isLanguage } from '@/lib/i18n';
import { Button, Notice } from '@/ui';
import { SupportContacts } from '@/ui/support-contacts';

import { OrderView } from './order-view';
import { useOrder, type OrderState } from './use-order';

function Problem({
  state,
  onRetry,
}: {
  state: Exclude<OrderState, { kind: 'ready' }>;
  onRetry: () => void;
}) {
  const { t } = useTranslation('ticket-order');
  if (state.kind === 'loading')
    return (
      <p role="status" className="m-0">
        {t('loading')}
      </p>
    );
  if (state.kind === 'disagreement') {
    // Never "try again" or "pay again": the same answer would come, and the money may be taken.
    return (
      <Notice tone="error" role="alert">
        <p>{t('disagreement.body')}</p>
        {state.requestId ? <p>{t('failed.reference', { requestId: state.requestId })}</p> : null}
        <SupportContacts linkClassName="text-action underline decoration-1 underline-offset-3" />
      </Notice>
    );
  }
  if (state.kind === 'failed') {
    return (
      <Notice
        tone="error"
        role="alert"
        action={
          <Button variant="secondary" onClick={onRetry}>
            {t('failed.retry')}
          </Button>
        }
      >
        <p>{t('failed.body')}</p>
        {state.requestId ? <p>{t('failed.reference', { requestId: state.requestId })}</p> : null}
      </Notice>
    );
  }
  return (
    <div className="grid gap-3">
      <h1 className="type-display-l text-heading m-0">{t(`${state.kind}.heading`)}</h1>
      <p className="m-0">{t(`${state.kind}.body`)}</p>
    </div>
  );
}

/**
 * The order in the language it names (design PD-189), which needn't be the one this device
 * negotiated. A language the app doesn't have keeps the negotiated one.
 */
function InOrderLanguage({ locale, children }: { locale: string | null; children: ReactNode }) {
  const i18n = useMemo(() => (isLanguage(locale) ? createI18n(locale) : null), [locale]);
  if (!i18n) return children;
  return (
    <I18nextProvider i18n={i18n}>
      <div lang={i18n.language} className="contents">
        {children}
      </div>
    </I18nextProvider>
  );
}

/**
 * The buyer's order, opened from its emailed link or straight after checkout or the bank (design
 * PD-81). `confirmFirst` on the bank's return: the return itself proves nothing.
 */
export function OrderPage({ confirmFirst = false }: { confirmFirst?: boolean }) {
  const { state, locale, isChecking, check } = useOrder({ confirmFirst });
  return (
    <PublicFrame>
      <InOrderLanguage locale={locale}>
        {state.kind === 'ready' ? (
          <OrderView read={state.read} isChecking={isChecking} onCheck={check} />
        ) : (
          <Problem state={state} onRetry={() => window.location.reload()} />
        )}
      </InOrderLanguage>
    </PublicFrame>
  );
}
