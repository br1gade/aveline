import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { browserSession } from '@/api/session';
import { LoadedProblem } from '@/features/sending';
import { APP_PATHS } from '@/route-paths';
import { StatusLine, useDialogOpener, usePageStatus, type PageActions } from '@/ui/app-form';
import { cn } from '@/ui/cn';

import { updateRequest } from '../api';
import { TABS, type DataRequestsData, type RequestTab } from '../load';
import { requestRefusalOf, type RequestRefusal } from '../refusals';
import type { RequestStep } from '../steps';
import type { Carried, DataRequest } from '../types';
import { CarriedResult, saveExport } from './carried-result';
import { RequestCard } from './request-card';
import { StepDialog, type AskedStep } from './request-dialogs';
import { RequestProblem } from './shared';

const TAB = 'border-border inline-flex min-h-11 items-center border px-3 py-2';
const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';

function Tabs({ tab }: { tab: RequestTab }) {
  const { t } = useTranslation('data-requests');
  return (
    <nav aria-label={t('tabsLabel')} className="flex flex-wrap gap-2">
      {TABS.map((name) => (
        <Link
          key={name}
          to={`${APP_PATHS.staffDataRequests}${name === 'open' ? '' : `?status=${name}`}`}
          aria-current={name === tab ? 'page' : undefined}
          className={cn(TAB, name === tab && 'bg-primary text-primary-foreground')}
        >
          {t(`tab.${name}`)}
        </Link>
      ))}
    </nav>
  );
}

interface OpenDialog {
  request: DataRequest;
  step: AskedStep;
}

/** Steps: starting to verify happens at once, and every other asks first. */
function useSteps(page: PageActions) {
  const { t } = useTranslation('data-requests');
  const { remember, restoreFocus } = useDialogOpener();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [refusal, setRefusal] = useState<RequestRefusal | null>(null);
  const [carried, setCarried] = useState<readonly Carried[]>([]);
  const onStep = (request: DataRequest, step: RequestStep, opener: HTMLElement) => {
    setRefusal(null);
    if (step !== 'verify') {
      remember(opener);
      setDialog({ request, step });
      return;
    }
    updateRequest(browserSession().api, request.id, { status: 'VERIFYING' }).then(
      () => page.done(t('status.verify')),
      (error: unknown) => {
        const found = requestRefusalOf(error);
        setRefusal(found);
        if (found.isStale) page.reload();
      },
    );
  };
  const onCarried = (next: Carried) => {
    if (next.kind === 'export') saveExport(next);
    setCarried((held) => [...held.filter((one) => one.reference !== next.reference), next]);
  };
  return { dialog, setDialog, refusal, carried, onStep, onCarried, restoreFocus };
}

/**
 * The queue of data-subject requests, soonest due first (docs/API.md §6; design PD-167). Administrators
 * only, and told so otherwise. Nothing from a request enters the address, storage or a log.
 */
export function DataRequestsPage({ data }: { data: DataRequestsData }) {
  const { t } = useTranslation('data-requests');
  const { tab, requests, now } = data;
  const { page, status, statusRef } = usePageStatus(data);
  const steps = useSteps(page);
  const { dialog } = steps;
  return (
    <section className="flex flex-col gap-5">
      <Link to={APP_PATHS.staff} className={LINK}>
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {steps.refusal ? <RequestProblem refusal={steps.refusal} /> : null}
      {steps.carried.map((carried) => (
        <CarriedResult key={carried.reference} carried={carried} />
      ))}
      {requests.kind === 'ready' ? (
        <>
          <Tabs tab={tab} />
          <p className="text-muted-foreground m-0 text-sm">
            {t(tab === 'open' ? 'limit' : 'limitClosed')}
          </p>
          {requests.value.length === 0 ? (
            <p className="m-0">{t(tab === 'open' ? 'none' : 'noneClosed')}</p>
          ) : null}
          <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
            {requests.value.map((request) => (
              <RequestCard
                key={`${request.id}:${request.notes ?? ''}`}
                request={request}
                now={now}
                page={page}
                onStep={steps.onStep}
              />
            ))}
          </ul>
        </>
      ) : (
        <LoadedProblem loaded={requests} refusedText={t('refusal.forbidden')} />
      )}
      {dialog ? (
        <StepDialog
          request={dialog.request}
          step={dialog.step}
          onCarried={steps.onCarried}
          page={page}
          onClose={() => steps.setDialog(null)}
          restoreFocus={steps.restoreFocus}
        />
      ) : null}
    </section>
  );
}
