import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { listVenues, type Venue } from '@/features/venues';
import { SelectField } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { NativeSelectOption } from '@/ui/kit/native-select';

import {
  listVenueLayouts,
  publishInventory,
  readInventory,
  readVenueLayout,
  type LayoutSummary,
  type PublishedInventory,
  type VenueLayout,
} from '../inventory-api';
import { inventoryRefusalOf, type InventoryRefusal } from '../inventory-refusals';
import { canEditByHand } from '../layout-form';
import type { TicketSalesData } from '../load';
import { inLanguage } from '../read';
import { InventoryProblem } from './inventory-problem';
import { InventorySections } from './inventory-sections';
import { VenueLayoutImport } from './venue-layout-import';
import { VenueLayoutEditor } from './venue-layout-editor';

interface PanelState {
  venues: Venue[];
  inventory: PublishedInventory | null;
}

export function ShowInventoryPanel({ data }: { data: TicketSalesData }) {
  const { t } = useTranslation('ticket-sales');
  const [state, setState] = useState<PanelState | null>(null);
  const [problem, setProblem] = useState<InventoryRefusal | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function load() {
    const api = browserSession().api;
    setProblem(null);
    setIsBusy(true);
    try {
      const [venues, inventory] = await Promise.all([
        listVenues(api, data.event.id),
        readInventory(api, data.event.id),
      ]);
      setState({
        venues: venues.filter(({ role, profileId }) => role !== 'PREPARATION' && profileId),
        inventory,
      });
    } catch (error) {
      setProblem(inventoryRefusalOf(error));
    } finally {
      setIsBusy(false);
    }
  }

  function complete(inventory: PublishedInventory) {
    setState((previous) => (previous ? { ...previous, inventory } : previous));
  }

  return (
    <section aria-labelledby="inventory-heading" className="border-border grid gap-3 border p-4">
      <h2 id="inventory-heading" className="m-0 text-lg font-medium">
        {t('inventory.title')}
      </h2>
      <InventoryProblem refusal={problem} action="read" />
      {state ? (
        <InventorySetup state={state} data={data} onPublish={complete} />
      ) : (
        <Button type="button" variant="outline" disabled={isBusy} onClick={() => void load()}>
          {t(isBusy ? 'inventory.loading' : 'inventory.manage')}
        </Button>
      )}
    </section>
  );
}

function InventorySetup({
  state,
  data,
  onPublish,
}: {
  state: PanelState;
  data: TicketSalesData;
  onPublish: (inventory: PublishedInventory) => void;
}) {
  const { t } = useTranslation('ticket-sales');
  const [venueId, setVenueId] = useState('');
  const venue = state.venues.find(({ id }) => id === venueId);
  if (state.inventory)
    return (
      <>
        <p role="status">{t('inventory.published')}</p>
        <ul>
          {state.inventory.sections.map(({ key, name }) => (
            <li key={key}>{name}</li>
          ))}
        </ul>
      </>
    );
  if (!state.venues.length) return <p>{t('inventory.noVenues')}</p>;
  return (
    <>
      <SelectField
        label={t('inventory.venue')}
        value={venueId}
        onChange={(event) => setVenueId(event.target.value)}
      >
        <NativeSelectOption value="">{t('inventory.chooseVenue')}</NativeSelectOption>
        {state.venues.map(({ id, name }) => (
          <NativeSelectOption key={id} value={id}>
            {name}
          </NativeSelectOption>
        ))}
      </SelectField>
      {venue ? (
        <ShowVenueSetup key={venue.id} data={data} venue={venue} onPublish={onPublish} />
      ) : null}
    </>
  );
}

function useVenueLayouts(eventId: string, venueId: string) {
  const [summaries, setSummaries] = useState<LayoutSummary[] | null>(null);
  const [layout, setLayout] = useState<VenueLayout | null>(null);
  const [problem, setProblem] = useState<InventoryRefusal | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function request(action: () => Promise<void>) {
    setProblem(null);
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      setProblem(inventoryRefusalOf(error));
    } finally {
      setIsBusy(false);
    }
  }

  const path = { eventId, venueId };
  const load = () =>
    request(async () => {
      setSummaries(await listVenueLayouts(browserSession().api, path));
    });
  const choose = (versionId: string) =>
    request(async () => {
      setLayout(
        versionId ? await readVenueLayout(browserSession().api, { ...path, versionId }) : null,
      );
    });
  function versionPublished(next: VenueLayout) {
    setLayout(next);
    setSummaries((previous) => [...(previous ?? []).filter(({ key }) => key !== next.key), next]);
  }
  return { summaries, layout, problem, isBusy, load, choose, versionPublished };
}

function ShowVenueSetup({
  data,
  venue,
  onPublish,
}: {
  data: TicketSalesData;
  venue: Venue;
  onPublish: (inventory: PublishedInventory) => void;
}) {
  const { t, i18n } = useTranslation('ticket-sales');
  const state = useVenueLayouts(data.event.id, venue.id);
  const { layout, summaries, isBusy } = state;
  const priceNames = data.types.map(({ id, name }) => ({
    id,
    name: inLanguage(name, i18n.language, data.event.defaultLocale) ?? id,
  }));
  return (
    <>
      <InventoryProblem refusal={state.problem} action="read" />
      <LayoutChoice state={state} />
      {venue.profileId ? (
        <LayoutEditors
          key={layout?.id ?? 'new'}
          profileId={venue.profileId}
          existing={layout ?? undefined}
          onPublish={state.versionPublished}
        />
      ) : null}
      {layout && !isBusy ? (
        <InventorySections
          key={layout.id}
          layout={layout}
          prices={priceNames}
          onSubmit={async (configuration) => {
            onPublish(
              await publishInventory(browserSession().api, data.event.id, {
                venueId: venue.id,
                layoutVersionId: layout.id,
                ...configuration,
              }),
            );
          }}
        />
      ) : null}
      {summaries?.length === 0 ? <p>{t('inventory.noLayouts')}</p> : null}
    </>
  );
}

interface LayoutEditorProps {
  profileId: string;
  existing?: VenueLayout | undefined;
  onPublish: (layout: VenueLayout) => void;
}

function LayoutEditors(props: LayoutEditorProps) {
  return (
    <>
      {canEditByHand(props.existing) ? <VenueLayoutEditor {...props} /> : null}
      <VenueLayoutImport {...props} />
    </>
  );
}

function LayoutChoice({ state }: { state: ReturnType<typeof useVenueLayouts> }) {
  const { t } = useTranslation('ticket-sales');
  if (!state.summaries)
    return (
      <Button
        type="button"
        variant="outline"
        disabled={state.isBusy}
        onClick={() => void state.load()}
      >
        {t(state.isBusy ? 'inventory.loading' : 'inventory.chooseLayout')}
      </Button>
    );
  return (
    <SelectField
      label={t('inventory.layout')}
      value={state.layout?.id ?? ''}
      disabled={state.isBusy}
      onChange={(event) => void state.choose(event.target.value)}
    >
      <NativeSelectOption value="">{t('inventory.chooseLayout')}</NativeSelectOption>
      {state.summaries.map(({ id, name, version }) => (
        <NativeSelectOption key={id} value={id}>
          {t('inventory.layoutOption', { name, version })}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}
