import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { expectData } from '@/api/client';
import type { PublicEvent, TicketSection } from '@/features/public-event';
import { Button, useIsHydrated } from '@/ui';
import { SelectField } from '@/ui/form';

import type { TicketSelection } from '../types';
import { useCheckoutApi } from './use-checkout-api';

const availabilitySchema = z.object({
  layoutVersionId: z.string(),
  available: z.number().int().nonnegative(),
  ticketTypeIds: z.array(z.string()),
  seats: z.array(z.object({ id: z.string(), row: z.string(), label: z.string() })),
});

type Availability = z.infer<typeof availabilitySchema>;
type ReadState = 'loading' | 'error' | Availability;
type ShowInventory = NonNullable<PublicEvent['ticketInventory']>;

interface Draft {
  scope: string;
  picks: Record<number, TicketSelection>;
  availability: Record<string, ReadState>;
}

export function useShowSelections(event: PublicEvent, scope: string) {
  const api = useCheckoutApi(event.locale);
  const [stored, setStored] = useState<Draft | null>(null);
  const current = (draft: Draft | null): Draft =>
    draft?.scope === scope ? draft : { scope, picks: {}, availability: {} };
  const generation = useRef(0);

  async function load(key: string) {
    const request = generation.current;
    setStored((draft) => {
      const next = current(draft);
      return { ...next, availability: { ...next.availability, [key]: 'loading' } };
    });
    const response = await expectData<unknown>(
      api.GET('/api/v1/public/events/{slug}/ticket-inventory/{sectionKey}', {
        params: { path: { slug: event.slug, sectionKey: key } },
      }),
    )
      .then((data) => availabilitySchema.parse(data))
      .catch(() => 'error' as const);
    if (request !== generation.current) return;
    setStored((draft) => {
      if (draft?.scope !== scope) return draft;
      return { ...draft, availability: { ...draft.availability, [key]: response } };
    });
  }

  function change(index: number, pick: TicketSelection | undefined) {
    setStored((draft) => {
      const next = current(draft);
      const picks = { ...next.picks };
      if (pick) picks[index] = pick;
      else delete picks[index];
      return { ...next, picks };
    });
  }

  function clear() {
    generation.current += 1;
    setStored(null);
  }

  return { ...current(stored), change, clear, load };
}

type SelectionState = ReturnType<typeof useShowSelections>;

function completePick(
  inventory: ShowInventory,
  draft: SelectionState,
  index: number,
  typeId: string,
) {
  const pick = draft.picks[index];
  const section = inventory.sections.find(({ key }) => key === pick?.sectionKey);
  if (!pick || !section) return undefined;
  const stock = draft.availability[section.key];
  if (!stock || typeof stock === 'string') return undefined;
  if (!isAvailable(stock, inventory.layoutVersionId, typeId)) return undefined;
  if (section.mode === 'NUMBERED')
    return stock.seats.some(({ id }) => id === pick.seatId) ? pick : undefined;
  const used = Object.values(draft.picks).filter(
    ({ sectionKey }) => sectionKey === section.key,
  ).length;
  return stock.available >= used ? pick : undefined;
}

function isAvailable(stock: Availability, version: string, ticketTypeId: string) {
  return stock.layoutVersionId === version && stock.ticketTypeIds.includes(ticketTypeId);
}

export function orderSelections(event: PublicEvent, draft: SelectionState, typeIds: string[]) {
  const inventory = event.ticketInventory;
  if (!inventory) return [];
  const picks = typeIds.flatMap(
    (typeId, index) => completePick(inventory, draft, index, typeId) ?? [],
  );
  return picks.length === typeIds.length ? picks : undefined;
}

interface SeatChoicesProps {
  section: TicketSection;
  stock: ReadState | undefined;
  pick: TicketSelection;
  taken: Set<string | undefined>;
  typeId: string;
  onChange: (seatId: string) => void;
  onReload: () => void;
}

function SeatChoices({
  section,
  stock,
  pick,
  taken,
  typeId,
  onChange,
  onReload,
}: SeatChoicesProps) {
  const { t } = useTranslation('checkout');
  if (!stock || stock === 'loading') return <p role="status">{t('selection.loading')}</p>;
  if (stock === 'error')
    return (
      <Button variant="secondary" className="justify-self-start" onClick={onReload}>
        {t('selection.retry')}
      </Button>
    );
  if (!stock.available || !stock.ticketTypeIds.includes(typeId))
    return <p role="status">{t('selection.soldOut')}</p>;
  if (section.mode === 'UNNUMBERED')
    return <p>{t('selection.remaining', { count: stock.available })}</p>;
  return (
    <SelectField
      label={t('selection.seat')}
      value={pick.seatId ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t('selection.choose')}</option>
      {stock.seats.map(({ id, row, label }) => (
        <option key={id} value={id} disabled={taken.has(id)}>
          {t('selection.seatName', { row, seat: label })}
        </option>
      ))}
    </SelectField>
  );
}

interface Slot {
  index: number;
  typeId: string;
  name: string | null | undefined;
}

function TicketSlot({
  slot,
  draft,
  inventory,
}: {
  slot: Slot;
  draft: SelectionState;
  inventory: ShowInventory;
}) {
  const { t } = useTranslation('checkout');
  const isHydrated = useIsHydrated();
  const { index, typeId, name } = slot;
  const pick = draft.picks[index];
  const sections = inventory.sections.filter((section) => section.ticketTypeIds.includes(typeId));
  const section = sections.find(({ key }) => key === pick?.sectionKey);
  const taken = new Set(
    Object.values(draft.picks)
      .filter((other) => other !== pick)
      .map(({ seatId }) => seatId),
  );
  function choose(key: string) {
    draft.change(index, key ? { sectionKey: key } : undefined);
    if (key && !draft.availability[key]) void draft.load(key);
  }
  return (
    <fieldset disabled={!isHydrated} className="grid gap-3">
      <legend>{t('selection.ticket', { count: index + 1, name: name ?? '' })}</legend>
      <SelectField
        label={t('selection.section')}
        value={pick?.sectionKey ?? ''}
        onChange={(event) => choose(event.target.value)}
      >
        <option value="">{t('selection.choose')}</option>
        {sections.map(({ key, name }) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </SelectField>
      {pick && section ? (
        <SeatChoices
          section={section}
          typeId={typeId}
          pick={pick}
          taken={taken}
          stock={draft.availability[section.key]}
          onReload={() => void draft.load(section.key)}
          onChange={(seatId) =>
            draft.change(index, { sectionKey: section.key, ...(seatId ? { seatId } : {}) })
          }
        />
      ) : null}
    </fieldset>
  );
}

export function ShowSelections({
  event,
  draft,
  typeIds,
}: {
  event: PublicEvent;
  draft: SelectionState;
  typeIds: string[];
}) {
  const { t } = useTranslation('checkout');
  const inventory = event.ticketInventory;
  if (!inventory) return null;
  const names = new Map(event.ticketTypes.map((type) => [type.id, type.name]));
  return (
    <section aria-labelledby="show-selections" className="grid gap-4">
      <h2 id="show-selections" className="type-heading-2 text-heading m-0">
        {t('selection.heading')}
      </h2>
      {typeIds.map((typeId, index) => (
        <TicketSlot
          key={index}
          slot={{ index, typeId, name: names.get(typeId) }}
          draft={draft}
          inventory={inventory}
        />
      ))}
    </section>
  );
}
