import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LoadedProblem } from '@/features/sending';
import { StatusLine, usePageStatus, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import type { DesignMediaData } from '../load';
import type { Design, LibraryItem } from '../types';
import { AltTextForm } from './alt-text-form';
import { DesignHeader, NoInvitation, useSectionName } from './design-parts';
import { MediaThumbnail } from './media-thumbnail';
import { RemoveMediaDialog } from './remove-media-dialog';
import { UploadForm } from './upload-form';

const SECTION_TITLE = 'm-0 text-lg font-medium';

/** A size in the page's language: kilobytes below a megabyte, one decimal at most. */
function useSize(): (bytes: number) => string {
  const { i18n } = useTranslation();
  return (bytes) => {
    const isLarge = bytes >= 1024 * 1024;
    return new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit: isLarge ? 'megabyte' : 'kilobyte',
      maximumFractionDigits: 1,
    }).format(bytes / (isLarge ? 1024 * 1024 : 1024));
  };
}

interface ItemProps {
  item: LibraryItem;
  design: Design;
  page: PageActions;
  onRemove: (item: LibraryItem) => void;
}

/** Where it shows; an upload shown anywhere cannot be removed, and the reason is beside it. */
function Uses({ item }: { item: LibraryItem }) {
  const { t } = useTranslation('design');
  const nameOf = useSectionName();
  const isUsed = item.usedBy.length > 0 || item.listingUses.length > 0;
  return (
    <>
      <p className="m-0 text-sm">
        {item.usedBy.length > 0
          ? t('media.usedBy', { sections: item.usedBy.map(nameOf).join(', ') })
          : t('media.notUsed')}
      </p>
      {item.listingUses.length > 0 ? <p className="m-0 text-sm">{t('media.listing')}</p> : null}
      {isUsed ? (
        <p className="text-muted-foreground m-0 text-sm">{t('media.cannotRemove')}</p>
      ) : null}
    </>
  );
}

function LibraryRow({ item, design, page, onRemove }: ItemProps) {
  const { t, i18n } = useTranslation('design');
  const size = useSize();
  const isUsed = item.usedBy.length > 0 || item.listingUses.length > 0;
  const languages = [i18n.language, design.event.defaultLocale];
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <MediaThumbnail media={item} languages={languages} />
      <p className="text-muted-foreground m-0 text-sm">{size(item.sizeBytes)}</p>
      <Uses item={item} />
      {item.kind === 'AUDIO' ? null : (
        <details className="group">
          <summary className="text-primary min-h-11 cursor-pointer py-2 underline underline-offset-4">
            {t('media.describe')}
          </summary>
          <AltTextForm
            item={item}
            locales={design.event.locales}
            eventId={design.event.id}
            page={page}
          />
        </details>
      )}
      {isUsed ? null : (
        <Button variant="ghost" className="self-start" onClick={() => onRemove(item)}>
          {t('media.remove')}
        </Button>
      )}
    </li>
  );
}

function Library({
  data,
  design,
  page,
}: {
  data: DesignMediaData;
  design: Design;
  page: PageActions;
}) {
  const { t, i18n } = useTranslation('design');
  const [target, setTarget] = useState<LibraryItem | null>(null);
  if (data.library.kind !== 'ready') {
    return <LoadedProblem loaded={data.library} refusedText={t('media.refused')} />;
  }
  const items = data.library.value;
  return (
    <>
      {items.length === 0 ? (
        <p className="text-muted-foreground m-0">{t('media.empty')}</p>
      ) : (
        <ul className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
          {/* Keyed by content too, so a saved description starts its form again from the server's. */}
          {items.map((item) => (
            <LibraryRow
              key={`${item.id}:${JSON.stringify(item.altText)}`}
              item={item}
              design={design}
              page={page}
              onRemove={setTarget}
            />
          ))}
        </ul>
      )}
      {target ? (
        <RemoveMediaDialog
          item={target}
          eventId={design.event.id}
          languages={[i18n.language, design.event.defaultLocale]}
          page={page}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </>
  );
}

function MediaPage({ data, design }: { data: DesignMediaData; design: Design }) {
  const { t } = useTranslation('design');
  const { page, status, statusRef } = usePageStatus(data);
  return (
    <section className="flex flex-col gap-6">
      <DesignHeader
        eventId={design.event.id}
        back="design"
        title={t('media.title')}
        subtitle={data.event.title}
      >
        <p className="m-0 max-w-[40rem]">{t('media.lead')}</p>
      </DesignHeader>
      <StatusLine statusRef={statusRef}>{status}</StatusLine>
      <section aria-labelledby="media-upload" className="flex flex-col gap-3">
        <h2 id="media-upload" className={SECTION_TITLE}>
          {t('media.uploadTitle')}
        </h2>
        <UploadForm eventId={design.event.id} page={page} />
      </section>
      <section aria-labelledby="media-library" className="flex flex-col gap-3">
        <h2 id="media-library" className={SECTION_TITLE}>
          {t('media.libraryTitle')}
        </h2>
        <Library data={data} design={design} page={page} />
      </section>
    </section>
  );
}

/**
 * The event's uploads (design PD-62): adding one, describing each picture in every language, and
 * removing one nothing shows. A section shows an upload once it is chosen on that section's page.
 */
export function DesignMedia({ data }: { data: DesignMediaData }) {
  if (!data.design) return <NoInvitation eventId={data.event.id} title={data.event.title} />;
  return <MediaPage data={data} design={data.design} />;
}
