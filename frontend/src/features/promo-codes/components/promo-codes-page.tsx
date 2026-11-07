import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { browserSession } from '@/api/session';
import { formatMinor } from '@/lib/money';
import { APP_PATHS } from '@/route-paths';
import {
  AskFirstDialog,
  StatusLine,
  useDialogAction,
  useDialogOpener,
  usePageStatus,
  WRAPPING_BUTTON,
  type DialogContext,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { stopPromoCode, updatePromoCode } from '../api';
import type { PromoCodesData } from '../load';
import { PROMO_CURRENCY, promoRefusalOf, promoState, zoneFor, type PromoRefusal } from '../rules';
import type { PromoCode } from '../types';
import { CreateForm } from './create-form';
import { LimitsDialog } from './limits-dialog';
import { PromoProblem, useDiscountText, useMoment } from './shared';

interface OpenDialog {
  kind: 'limits' | 'stop';
  promo: PromoCode;
}
type OpenHandler = (dialog: OpenDialog, opener: HTMLElement) => void;

interface RowContext {
  zones: ReadonlyMap<string, string>;
  now: number;
  onOpen: OpenHandler;
  onUseAgain: (promo: PromoCode) => void;
  usingAgainId: string | null;
}

/** What it gives, where, how often, from and until when, and where it stands now. */
function CodeFacts({
  promo,
  zones,
  now,
}: {
  promo: PromoCode;
  zones: ReadonlyMap<string, string>;
  now: number;
}) {
  const { t, i18n } = useTranslation('promo-codes');
  const zone = zoneFor(promo.eventId, zones);
  const moment = useMoment(zone);
  const lines = [
    useDiscountText()(promo),
    promo.eventId
      ? t('code.forEvent', { title: promo.eventTitle ?? t('code.someEvent') })
      : t('code.everyEvent'),
    promo.maxRedemptions === null
      ? t('code.usedNoLimit', { count: promo.redemptions })
      : t('code.used', {
          count: promo.redemptions,
          limit: promo.maxRedemptions,
          left: promo.remaining ?? 0,
        }),
    promo.minOrderMinor
      ? t('code.minOrder', {
          amount: formatMinor(promo.minOrderMinor, PROMO_CURRENCY, i18n.language),
        })
      : '',
    promo.validFrom ? t('code.from', { when: moment(promo.validFrom) }) : '',
    promo.validUntil
      ? t('code.until', { when: moment(promo.validUntil), timeZone: zone.replaceAll('_', ' ') })
      : '',
  ].filter(Boolean);
  return (
    <>
      {lines.map((line) => (
        <p key={line} className="m-0 text-sm">
          {line}
        </p>
      ))}
      <p className="m-0 text-sm font-medium">{t(`state.${promoState(promo, now)}`)}</p>
    </>
  );
}

function CodeRow({ promo, ...context }: RowContext & { promo: PromoCode }) {
  const { t } = useTranslation('promo-codes');
  return (
    <li className="bg-card border-border flex flex-col gap-1 border px-5 py-4">
      <span className="font-medium tracking-wide break-all">{promo.code}</span>
      <CodeFacts promo={promo} zones={context.zones} now={context.now} />
      <div className="mt-1 flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={WRAPPING_BUTTON}
          aria-label={t('code.editFor', { code: promo.code })}
          onClick={(click) => context.onOpen({ kind: 'limits', promo }, click.currentTarget)}
        >
          {t('code.edit')}
        </Button>
        {promo.isActive ? (
          <Button
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-label={t('code.stopFor', { code: promo.code })}
            onClick={(click) => context.onOpen({ kind: 'stop', promo }, click.currentTarget)}
          >
            {t('code.stop')}
          </Button>
        ) : (
          <Button
            variant="outline"
            className={WRAPPING_BUTTON}
            disabled={context.usingAgainId === promo.id}
            aria-label={t('code.useAgainFor', { code: promo.code })}
            onClick={() => context.onUseAgain(promo)}
          >
            {t('code.useAgain')}
          </Button>
        )}
      </div>
    </li>
  );
}

function StopDialog({ promo, ...context }: DialogContext & { promo: PromoCode }) {
  const { t } = useTranslation('promo-codes');
  const action = useDialogAction(context, promoRefusalOf);
  return (
    <AskFirstDialog
      onOpenChange={action.onOpenChange}
      onCloseAutoFocus={action.onCloseAutoFocus}
      title={t('stop.title', { code: promo.code })}
      body={t('stop.body')}
      confirmLabel={t('stop.confirm')}
      isBusy={action.isBusy}
      problem={action.refusal ? <PromoProblem refusal={action.refusal} /> : null}
      onConfirm={() =>
        void action.run(
          () => stopPromoCode(browserSession().api, promo.id),
          t('status.stopped', { code: promo.code }),
        )
      }
    />
  );
}

/** Using a stopped code again goes at once: it is no more than undoing a stop. */
function useUseAgain(page: PageActions) {
  const { t } = useTranslation('promo-codes');
  const [usingAgainId, setUsingAgainId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<PromoRefusal | null>(null);
  const useAgain = async (promo: PromoCode) => {
    setRefusal(null);
    setUsingAgainId(promo.id);
    try {
      await updatePromoCode(browserSession().api, promo.id, { isActive: true });
      await page.done(t('status.usedAgain', { code: promo.code }));
    } catch (error) {
      const found = promoRefusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    } finally {
      setUsingAgainId(null);
    }
  };
  return { usingAgainId, refusal, useAgain };
}

function CodeList({ codes, ...context }: RowContext & { codes: readonly PromoCode[] }) {
  const { t } = useTranslation('promo-codes');
  return (
    <section aria-labelledby="promo-codes-list" className="flex max-w-[40rem] flex-col gap-3">
      <h2 id="promo-codes-list" className="m-0 text-lg font-medium">
        {t('list.title')}
      </h2>
      {codes.length === 0 ? <p className="m-0">{t('list.empty')}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {codes.map((promo) => (
          <CodeRow key={promo.id} promo={promo} {...context} />
        ))}
      </ul>
    </section>
  );
}

function CurrentDialog({
  dialog,
  zones,
  context,
}: {
  dialog: OpenDialog | null;
  zones: ReadonlyMap<string, string>;
  context: DialogContext;
}) {
  if (!dialog) return null;
  if (dialog.kind === 'stop') return <StopDialog {...context} promo={dialog.promo} />;
  return (
    <LimitsDialog {...context} promo={dialog.promo} zone={zoneFor(dialog.promo.eventId, zones)} />
  );
}

/**
 * The organization's promo codes (docs/API.md §6; design PD-116 to PD-118): listed, made, corrected,
 * stopped and used again. Nothing is ever deleted, as the API keeps every code a refund may need.
 * Only the organization's owner holds `billing:*`; anyone else is told so, and the form stays, its
 * refusal worded (FR-6). While payments are off, only a code that makes an order free goes through.
 */
export function PromoCodesPage({ data }: { data: PromoCodesData }) {
  const { t } = useTranslation('promo-codes');
  const { page, status, statusRef } = usePageStatus(data);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const again = useUseAgain(page);
  const events = data.events ?? [];
  const open: OpenHandler = (next, opener) => {
    remember(opener);
    setDialog(next);
  };
  const context = { page, onClose: () => setDialog(null), restoreFocus };
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={APP_PATHS.app}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <p className="border-border m-0 max-w-[40rem] border-l-2 pl-3">{t('pilot')}</p>
      {data.events ? null : <p className="m-0">{t('eventsUnread')}</p>}
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {again.refusal ? <PromoProblem refusal={again.refusal} /> : null}
      {data.codes.kind === 'ready' ? (
        <CodeList
          codes={data.codes.value}
          zones={data.zones}
          now={data.now}
          onOpen={open}
          onUseAgain={(promo) => void again.useAgain(promo)}
          usingAgainId={again.usingAgainId}
        />
      ) : (
        <PromoProblem refusal={data.codes.refusal} />
      )}
      <CreateForm events={events} zones={data.zones} page={page} />
      <CurrentDialog dialog={dialog} zones={data.zones} context={context} />
    </section>
  );
}
