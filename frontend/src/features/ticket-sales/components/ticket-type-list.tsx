import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { formatMinor } from '@/lib/money';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { ProblemAlert, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { deleteTicketType, updateTicketType } from '../api';
import type { TicketSalesData } from '../load';
import { editTicketTypePath, newTicketTypePath } from '../paths';
import { inLanguage } from '../read';
import { typeRefusal, type TypeRefusal } from '../refusals';
import type { TicketType } from '../types';
import { ConfirmDialog, HEADING, PANEL } from './shared';

function useWindow(type: TicketType, event: EventDetail): string | null {
  const { t, i18n } = useTranslation('ticket-sales');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  const at = (iso: string) => `${formatEventDate(iso, zone)}, ${formatEventTime(iso, zone)}`;
  if (type.salesStartAt && type.salesEndAt)
    return t('types.window.both', { start: at(type.salesStartAt), end: at(type.salesEndAt) });
  if (type.salesStartAt) return t('types.window.from', { start: at(type.salesStartAt) });
  if (type.salesEndAt) return t('types.window.until', { end: at(type.salesEndAt) });
  return null;
}

/** A refusal of one card's action, in our words; anything unknown by its status. */
function RefusalText({ refusal }: { refusal: TypeRefusal }) {
  const { t } = useTranslation('ticket-sales');
  if (refusal.kind === 'other') {
    return <ProblemAlert problem={problemFrom(refusal.error)} refused={() => t('refused')} />;
  }
  return (
    <p role="alert" className="text-destructive m-0 text-sm">
      {t(`types.refusals.${refusal.kind === 'fields' ? 'capacityTaken' : refusal.kind}`)}
    </p>
  );
}

interface CardProps {
  type: TicketType;
  event: EventDetail;
  page: PageActions;
  onRemove: (type: TicketType) => void;
}

/** Stopping or resuming its sale: a `PATCH` of `isActive`, nothing deleted. */
function useToggle({ type, event, page }: Omit<CardProps, 'onRemove'>, name: string) {
  const { t } = useTranslation('ticket-sales');
  const [refusal, setRefusal] = useState<TypeRefusal | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const toggle = async () => {
    setRefusal(null);
    setIsBusy(true);
    try {
      await updateTicketType(browserSession().api, event.id, type.id, { isActive: !type.isActive });
      await page.done(t(type.isActive ? 'types.stopped' : 'types.resumed', { name }));
    } catch (error) {
      setRefusal(typeRefusal(error));
    } finally {
      setIsBusy(false);
    }
  };
  return { refusal, isBusy, toggle };
}

function CardActions({
  type,
  event,
  name,
  toggle,
  onRemove,
}: CardProps & { name: string; toggle: ReturnType<typeof useToggle> }) {
  const { t } = useTranslation('ticket-sales');
  const named = (action: 'types.edit' | 'types.stop' | 'types.resume' | 'types.remove') =>
    t('actionFor', { action: t(action), name });
  const toggleAction = type.isActive ? 'types.stop' : 'types.resume';
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      <Button asChild variant="outline">
        <Link to={editTicketTypePath(event.id, type.id)} aria-label={named('types.edit')}>
          {t('types.edit')}
        </Link>
      </Button>
      <Button
        variant="outline"
        disabled={toggle.isBusy}
        onClick={() => void toggle.toggle()}
        aria-label={named(toggleAction)}
      >
        {t(toggleAction)}
      </Button>
      {type.sold + type.held === 0 ? (
        <Button variant="ghost" onClick={() => onRemove(type)} aria-label={named('types.remove')}>
          {t('types.remove')}
        </Button>
      ) : null}
    </div>
  );
}

function TypeCard(props: CardProps) {
  const { type, event } = props;
  const { t, i18n } = useTranslation('ticket-sales');
  const name = inLanguage(type.name, i18n.language, event.defaultLocale) ?? t('types.unnamed');
  const window = useWindow(type, event);
  const toggle = useToggle(props, name);
  const price =
    type.priceMinor === '0'
      ? t('types.free')
      : formatMinor(type.priceMinor, type.currency, i18n.language);
  const counts = {
    sold: type.sold,
    held: type.held,
    available: type.available,
    total: type.quantityTotal,
  };
  return (
    <li className="bg-card border-border flex flex-col gap-1 border px-5 py-4">
      <h3 className="m-0 text-base font-medium break-words">{name}</h3>
      {type.isActive ? null : (
        <p className="text-muted-foreground m-0 text-sm font-medium">{t('types.inactive')}</p>
      )}
      <p className="m-0">{price}</p>
      <p className="m-0 text-sm">{t('types.counts', counts)}</p>
      <p className="m-0 text-sm">
        {t('types.perOrder', { min: type.minPerOrder, max: type.maxPerOrder })}
      </p>
      {window ? <p className="m-0 text-sm">{window}</p> : null}
      {toggle.refusal ? <RefusalText refusal={toggle.refusal} /> : null}
      <CardActions {...props} name={name} toggle={toggle} />
    </li>
  );
}

function RemoveDialog({
  type,
  event,
  page,
  onClose,
}: {
  type: TicketType;
  event: EventDetail;
  page: PageActions;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('ticket-sales');
  const [isBusy, setIsBusy] = useState(false);
  const [refusal, setRefusal] = useState<TypeRefusal | null>(null);
  const name = inLanguage(type.name, i18n.language, event.defaultLocale) ?? t('types.unnamed');
  const remove = async () => {
    setIsBusy(true);
    try {
      await deleteTicketType(browserSession().api, event.id, type.id);
      onClose();
      await page.done(t('types.removed', { name }));
    } catch (error) {
      const refused = typeRefusal(error);
      setRefusal(refused);
      if (refused.kind === 'gone') page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <ConfirmDialog
      title={t('types.removeTitle', { name })}
      body={t('types.removeBody')}
      confirmLabel={t('types.remove')}
      isBusy={isBusy || refusal?.kind === 'inUse'}
      problem={refusal ? <RefusalText refusal={refusal} /> : null}
      onConfirm={() => void remove()}
      onClose={onClose}
      onCloseAutoFocus={page.focusStatus}
    />
  );
}

/** What is for sale (design PD-84): each type's price, counts, limits and window, and its actions. */
export function TicketTypesPanel({ data, page }: { data: TicketSalesData; page: PageActions }) {
  const { t } = useTranslation('ticket-sales');
  const [removing, setRemoving] = useState<TicketType | null>(null);
  const { event, types } = data;
  return (
    <section aria-labelledby="types-heading" className={PANEL}>
      <h2 id="types-heading" className={HEADING}>
        {t('types.heading')}
      </h2>
      <p className="m-0 text-sm">{t('types.lead')}</p>
      {types.length === 0 ? (
        <p className="text-muted-foreground m-0">{t('types.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {types.map((type) => (
            <TypeCard key={type.id} type={type} event={event} page={page} onRemove={setRemoving} />
          ))}
        </ul>
      )}
      <Button asChild className="self-start">
        <Link to={newTicketTypePath(event.id)}>{t('types.add')}</Link>
      </Button>
      {removing ? (
        <RemoveDialog
          key={removing.id}
          type={removing}
          event={event}
          page={page}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </section>
  );
}
