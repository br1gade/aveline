import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { LoadedProblem } from '@/features/sending';
import {
  StatusLine,
  useDialogOpener,
  usePageStatus,
  WRAPPING_BUTTON as WRAPPING,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { DirectoryPageData } from '../load';
import { venuesPath } from '../paths';
import type { DirectoryHall } from '../types';
import { HallDialog, RetireHallDialog } from './hall-dialogs';

type OpenDialog =
  { kind: 'add' } | { kind: 'edit'; hall: DirectoryHall } | { kind: 'retire'; hall: DirectoryHall };

type OpenHandler = (dialog: OpenDialog, opener: HTMLElement) => void;

function HallRow({ hall, onOpen }: { hall: DirectoryHall; onOpen: OpenHandler }) {
  const { t } = useTranslation('venues');
  const facts = [
    hall.city ?? t('directory.noCity'),
    hall.capacity ? t('directory.capacity', { count: hall.capacity }) : '',
    hall.operatorName
      ? t('directory.runBy', { name: hall.operatorName })
      : t('directory.noOperator'),
  ];
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium break-words">{hall.name}</span>
        <span className="text-muted-foreground text-sm break-words">{hall.address}</span>
      </div>
      <p className="m-0 text-sm">{facts.filter(Boolean).join(' · ')}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className={WRAPPING}
          aria-label={t('directory.editFor', { name: hall.name })}
          onClick={(click) => onOpen({ kind: 'edit', hall }, click.currentTarget)}
        >
          {t('directory.edit')}
        </Button>
        <Button
          variant="outline"
          className={WRAPPING}
          aria-label={t('directory.retireFor', { name: hall.name })}
          onClick={(click) => onOpen({ kind: 'retire', hall }, click.currentTarget)}
        >
          {t('directory.retire')}
        </Button>
      </div>
    </li>
  );
}

function CurrentDialog({
  dialog,
  data,
  ...context
}: {
  dialog: OpenDialog | null;
  data: DirectoryPageData;
  page: PageActions;
  onClose: () => void;
  restoreFocus: (closing: Event) => void;
}) {
  if (!dialog) return null;
  if (dialog.kind === 'retire') return <RetireHallDialog {...context} hall={dialog.hall} />;
  return (
    <HallDialog
      {...context}
      hall={dialog.kind === 'edit' ? dialog.hall : null}
      operators={data.operators}
    />
  );
}

/**
 * The shared directory (docs/API.md §6; design PD-102). **Writing it is staff-only:** no customer
 * role holds `directory:manage`, so a customer reads it and meets a worded 403 on every change
 * (FR-6). It sits under an event because the API has no directory read outside one (FR-91).
 */
export function VenueDirectoryPage({ data }: { data: DirectoryPageData }) {
  const { t } = useTranslation('venues');
  const { event, directory } = data;
  const { page, status, statusRef } = usePageStatus(data);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const { remember, restoreFocus } = useDialogOpener();
  const open: OpenHandler = (next, opener) => {
    remember(opener);
    setDialog(next);
  };
  return (
    <section className="flex flex-col gap-6">
      <Link
        to={venuesPath(event.id)}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('directory.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {t('directory.title')}
        </h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('directory.lead')}</p>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <Button
        className={`self-start ${WRAPPING}`}
        onClick={(click) => open({ kind: 'add' }, click.currentTarget)}
      >
        {t('directory.add')}
      </Button>
      {directory.kind === 'ready' ? (
        <>
          {directory.value.length === 0 ? <p className="m-0">{t('directory.empty')}</p> : null}
          <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
            {directory.value.map((hall) => (
              <HallRow key={hall.id} hall={hall} onOpen={open} />
            ))}
          </ul>
        </>
      ) : (
        <LoadedProblem loaded={directory} refusedText={t('directory.readRefused')} />
      )}
      <CurrentDialog
        dialog={dialog}
        data={data}
        page={page}
        onClose={() => setDialog(null)}
        restoreFocus={restoreFocus}
      />
    </section>
  );
}
