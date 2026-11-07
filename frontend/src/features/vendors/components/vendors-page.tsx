import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { APP_PATHS } from '@/route-paths';
import { StatusLine, usePageStatus } from '@/ui/app-form';

import type { VendorsData } from '../load';
import { isVendorCategory, VENDOR_CATEGORIES } from '../scopes';
import type { Hall, Vendor, VendorCategory } from '../types';
import { AddVendorForm } from './add-vendor-form';
import { Fact, PageHeading, useCategoryText, VendorProblem } from './shared';

const FILTER_LINK =
  'border-border inline-flex min-h-11 items-center border px-3 text-sm aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground';

/** The category in the address, so a reload or a shared link keeps it; anything else is all. */
function useCategoryFilter(): VendorCategory | null {
  const [params] = useSearchParams();
  const category = params.get('category') ?? '';
  return isVendorCategory(category) ? category : null;
}

function CategoryFilter({ current }: { current: VendorCategory | null }) {
  const { t } = useTranslation('vendors');
  const categoryText = useCategoryText();
  const links: Array<{ category: VendorCategory | null; label: string }> = [
    { category: null, label: t('filter.all') },
    ...VENDOR_CATEGORIES.map((category) => ({ category, label: categoryText(category) })),
  ];
  return (
    <nav aria-label={t('filter.label')}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
        {links.map(({ category, label }) => (
          <li key={category ?? 'all'}>
            <Link
              to={{ search: category ? `?category=${category}` : '' }}
              replace
              preventScrollReset
              aria-current={current === category ? 'page' : undefined}
              className={FILTER_LINK}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HallLine({ hall }: { hall: Hall }) {
  const { t } = useTranslation('vendors');
  const details = [
    hall.city,
    hall.capacity === null ? '' : t('halls.capacity', { value: hall.capacity }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="break-words">
      {details ? t('pair', { label: hall.name, value: details }) : hall.name}
    </li>
  );
}

function VendorRow({ vendor }: { vendor: Vendor }) {
  const { t } = useTranslation('vendors');
  const categoryText = useCategoryText();
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <span className="font-medium break-words">{vendor.name}</span>
      <p className="m-0 text-sm">
        {categoryText(vendor.category)} · {vendor.isCurated ? t('list.curated') : t('list.own')}
      </p>
      <dl className="m-0 grid gap-2">
        {vendor.email ? <Fact label={t('list.email')}>{vendor.email}</Fact> : null}
        {vendor.phone ? <Fact label={t('list.phone')}>{vendor.phone}</Fact> : null}
      </dl>
      {vendor.halls.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-sm font-medium">{t('halls.title')}</p>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            {vendor.halls.map((hall) => (
              <HallLine key={hall.id} hall={hall} />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function VendorList({
  vendors,
  category,
}: {
  vendors: readonly Vendor[];
  category: VendorCategory | null;
}) {
  const { t } = useTranslation('vendors');
  const headingId = useId();
  const shown = category ? vendors.filter((vendor) => vendor.category === category) : vendors;
  return (
    <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('list.title')}
      </h2>
      <CategoryFilter current={category} />
      {shown.length === 0 ? (
        <p className="m-0">{category ? t('list.emptyCategory') : t('list.empty')}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {shown.map((vendor) => (
            <VendorRow key={vendor.id} vendor={vendor} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The organization's vendors (docs/API.md §6; design PD-120): its own, which only it sees, and
 * Aveline's curated list, which every organization sees and none can change. A vendor once added
 * can't be corrected or removed (FR-102); a curated venue vendor's halls are kept by Aveline's
 * staff. Every role is offered everything, and a refusal is worded (FR-6).
 */
export function VendorsPage({ data }: { data: VendorsData }) {
  const { t } = useTranslation('vendors');
  const { page, status, statusRef } = usePageStatus(data);
  const category = useCategoryFilter();
  return (
    <section className="flex flex-col gap-6">
      <PageHeading back={APP_PATHS.app} backLabel={t('backHome')} title={t('title')} />
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <p className="border-border m-0 max-w-[40rem] border-l-2 pl-3">{t('cantCorrect')}</p>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      {data.vendors.kind === 'ready' ? (
        <VendorList vendors={data.vendors.value} category={category} />
      ) : (
        <VendorProblem refusal={data.vendors.refusal} />
      )}
      <AddVendorForm page={page} />
    </section>
  );
}
