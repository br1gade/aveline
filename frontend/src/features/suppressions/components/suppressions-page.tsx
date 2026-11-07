import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { browserSession } from '@/api/session';
import { DEFAULT_TIME_ZONE, formatEventDay } from '@/lib/time';
import { APP_PATHS } from '@/route-paths';
import {
  AskFirstDialog,
  StatusLine,
  useDialogAction,
  useDialogOpener,
  usePageStatus,
  WRAPPING_BUTTON,
  type DialogContext,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { liftSuppression } from '../api';
import type { SuppressionsData } from '../load';
import { isLiftable, mayBeTruncated, suppressionRefusalOf } from '../rules';
import type { Suppression } from '../types';
import { AddForm } from './add-form';
import { SuppressionProblem } from './shared';

type OpenHandler = (entry: Suppression, opener: HTMLElement) => void;

function useShownAddress() {
  const { t } = useTranslation('suppressions');
  return (entry: Suppression) => (entry.isErasedAddress ? t('entry.erasedAddress') : entry.address);
}

function EntryRow({ entry, onOpen }: { entry: Suppression; onOpen: OpenHandler }) {
  const { t, i18n } = useTranslation('suppressions');
  const address = useShownAddress()(entry);
  // No event names a zone here: Yerevan, the backend's own default, never the device's (PD-114).
  const added = formatEventDay(entry.createdAt, {
    timeZone: DEFAULT_TIME_ZONE,
    locale: i18n.language,
  });
  return (
    <li className="bg-card border-border flex flex-col gap-1 border px-5 py-4">
      <span className="font-medium break-all">{address}</span>
      <p className="m-0 text-sm">
        {t('entry.line', {
          channel: t(`channel.${entry.channel}`),
          reason: t(`reason.${entry.reason}`),
          added,
        })}
      </p>
      {isLiftable(entry) ? (
        <Button
          variant="outline"
          className={`mt-1 self-start ${WRAPPING_BUTTON}`}
          aria-label={t('entry.liftFor', { address })}
          onClick={(click) => onOpen(entry, click.currentTarget)}
        >
          {t('entry.lift')}
        </Button>
      ) : (
        <p className="text-muted-foreground m-0 text-sm">
          {t(entry.isGlobal ? 'entry.global' : 'entry.erased')}
        </p>
      )}
    </li>
  );
}

function LiftDialog({ entry, ...context }: DialogContext & { entry: Suppression }) {
  const { t } = useTranslation('suppressions');
  const address = useShownAddress()(entry);
  const action = useDialogAction(context, suppressionRefusalOf);
  return (
    <AskFirstDialog
      onOpenChange={action.onOpenChange}
      onCloseAutoFocus={action.onCloseAutoFocus}
      title={t('lift.title', { address })}
      body={t('lift.body')}
      confirmLabel={t('lift.confirm')}
      isBusy={action.isBusy}
      problem={action.refusal ? <SuppressionProblem refusal={action.refusal} /> : null}
      onConfirm={() =>
        void action.run(
          () => liftSuppression(browserSession().api, entry.id),
          t('status.lifted', { address }),
        )
      }
    />
  );
}

function EntryList({ list, onOpen }: { list: readonly Suppression[]; onOpen: OpenHandler }) {
  const { t } = useTranslation('suppressions');
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('list.title')}
      </h2>
      {list.length === 0 ? <p className="m-0">{t('list.empty')}</p> : null}
      {mayBeTruncated(list) ? <p className="m-0">{t('list.truncated')}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {list.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Who must not be contacted (docs/API.md §6, "Suppression"; design PD-114, PD-115). The list is
 * the organization's: it applies to every event, and only the organization's owner or a manager
 * reaches it. Someone on one event alone is told so (FR-98). A role refused the list keeps the form,
 * whose own refusal is worded (FR-6).
 */
export function SuppressionsPage({ data }: { data: SuppressionsData }) {
  const { t } = useTranslation('suppressions');
  const { page, status, statusRef } = usePageStatus(data);
  const [lifting, setLifting] = useState<Suppression | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const { list } = data;
  const open: OpenHandler = (entry, opener) => {
    remember(opener);
    setLifting(entry);
  };
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
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {list.kind === 'ready' ? (
        <EntryList list={list.value} onOpen={open} />
      ) : (
        <SuppressionProblem refusal={list.refusal} />
      )}
      <AddForm list={list.kind === 'ready' ? list.value : []} page={page} />
      {lifting ? (
        <LiftDialog
          entry={lifting}
          page={page}
          onClose={() => setLifting(null)}
          restoreFocus={restoreFocus}
        />
      ) : null}
    </section>
  );
}
