import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom, type Problem } from '@/api/problems';
import { AppForm, ProblemAlert, SubmitButton, useLeaveGuardWhen } from '@/ui/app-form';

import type { VenueLayout } from '../inventory-api';

interface Configuration {
  offers: { sectionKey: string; ticketTypeId: string }[];
  blockedSeats: { sectionKey: string; row: string; seat: string }[];
}

interface InventorySectionsProps {
  layout: VenueLayout;
  prices: { id: string; name: string }[];
  onSubmit: (configuration: Configuration) => Promise<void>;
}

type Section = VenueLayout['sections'][number];
type PickedOffers = Record<string, string[]>;

function blockKey(row: string, seat: string) {
  return JSON.stringify([row, seat]);
}

function prepare(layout: VenueLayout, picked: PickedOffers, blocked: PickedOffers): Configuration {
  const offers = layout.sections.flatMap(({ key }) =>
    (picked[key] ?? []).map((ticketTypeId) => ({ sectionKey: key, ticketTypeId })),
  );
  const blockedSeats = layout.sections.flatMap((section) => {
    if (section.mode !== 'NUMBERED' || !picked[section.key]?.length) return [];
    const selected = new Set(blocked[section.key]);
    return section.rows.flatMap(({ label: row, seats }) =>
      seats
        .filter((seat) => selected.has(blockKey(row, seat)))
        .map((seat) => ({ sectionKey: section.key, row, seat })),
    );
  });
  return { offers, blockedSeats };
}

function changed(previous: PickedOffers, key: string, id: string, isChecked: boolean) {
  const values = new Set(previous[key]);
  if (isChecked) values.add(id);
  else values.delete(id);
  return { ...previous, [key]: [...values] };
}

function SeatBlocks({
  section,
  selected,
  onChange,
}: {
  section: Extract<Section, { mode: 'NUMBERED' }>;
  selected: string[];
  onChange: (id: string, isChecked: boolean) => void;
}) {
  const { t } = useTranslation('ticket-sales');
  const [isOpen, setIsOpen] = useState(false);
  const chosen = new Set(selected);
  return (
    <details onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer">
        {t('inventory.blocked')} ({selected.length})
      </summary>
      {isOpen ? (
        <div className="grid gap-2">
          {section.rows.map(({ label, seats }) => (
            <fieldset key={label}>
              <legend>
                {t('inventory.row')} {label}
              </legend>
              <div className="flex flex-wrap gap-2">
                {seats.map((seat) => {
                  const id = blockKey(label, seat);
                  return (
                    <label key={id} className="inline-flex min-h-11 min-w-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={chosen.has(id)}
                        onChange={(event) => onChange(id, event.target.checked)}
                      />
                      {seat}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}
    </details>
  );
}

interface OfferFieldsProps {
  section: Section;
  prices: InventorySectionsProps['prices'];
  picked: string[];
  blocked: string[];
  onOffer: (id: string, isChecked: boolean) => void;
  onBlock: (id: string, isChecked: boolean) => void;
}

function OfferFields({ section, prices, picked, blocked, onOffer, onBlock }: OfferFieldsProps) {
  const { t } = useTranslation('ticket-sales');
  return (
    <fieldset className="border-border grid gap-2 border p-3">
      <legend>{section.name}</legend>
      {section.mode === 'UNNUMBERED' ? (
        <p>
          {t('inventory.capacity')} {section.capacity}
        </p>
      ) : null}
      {prices.map(({ id, name }) => (
        <label key={id} className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={picked.includes(id)}
            onChange={(event) => onOffer(id, event.target.checked)}
          />
          {name}
        </label>
      ))}
      {section.mode === 'NUMBERED' && picked.length ? (
        <SeatBlocks section={section} selected={blocked} onChange={onBlock} />
      ) : null}
    </fieldset>
  );
}

export function InventorySections({ layout, prices, onSubmit }: InventorySectionsProps) {
  const { t } = useTranslation('ticket-sales');
  const [picked, setPicked] = useState<PickedOffers>({});
  const [blocked, setBlocked] = useState<PickedOffers>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canPublish = Object.values(picked).some((offers) => offers.length);
  useLeaveGuardWhen(canPublish && !isSaving);
  async function publish() {
    if (!canPublish || isSaving) return;
    setIsSaving(true);
    setProblem(null);
    try {
      await onSubmit(prepare(layout, picked, blocked));
    } catch (error) {
      setProblem(problemFrom(error));
    } finally {
      setIsSaving(false);
    }
  }
  if (!prices.length) return <p>{t('inventory.noTypes')}</p>;
  return (
    <AppForm
      onSubmit={(event) => {
        event.preventDefault();
        void publish();
      }}
    >
      <h3 className="m-0">{t('inventory.offers')}</h3>
      {problem ? <ProblemAlert problem={problem} refused={() => t('inventory.failed')} /> : null}
      {layout.sections.map((section) => (
        <OfferFields
          key={section.key}
          section={section}
          prices={prices}
          picked={picked[section.key] ?? []}
          blocked={blocked[section.key] ?? []}
          onOffer={(id, isChecked) =>
            setPicked((prior) => changed(prior, section.key, id, isChecked))
          }
          onBlock={(id, isChecked) =>
            setBlocked((prior) => changed(prior, section.key, id, isChecked))
          }
        />
      ))}
      <p>{t('inventory.warning')}</p>
      <SubmitButton isSubmitting={isSaving || !canPublish}>{t('inventory.publish')}</SubmitButton>
    </AppForm>
  );
}
