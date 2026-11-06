import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { NotifyGuests } from '@/features/events';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

/**
 * Telling guests about a change that offers it by nothing else (design PD-177): the backend suggests it
 * only after the date, the time or a venue changes, and the page for how guests answer offers it
 * after its own change. Anything else guests should hear of, such as the running order, is told
 * from here, and only when the host asks (docs/API.md §6).
 */
export function TellGuestsPanel({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('sending');
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-2">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('tell.title')}
      </h2>
      <p className="m-0">{t('tell.body')}</p>
      <Button
        type="button"
        variant="outline"
        className={`${WRAPPING_BUTTON} self-start`}
        onClick={onOpen}
      >
        {t('tell.open')}
      </Button>
    </section>
  );
}

/** The offer, in place of the page until the host sends it or goes back. Nothing is sent before. */
export function TellGuests({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { t } = useTranslation('sending');
  return (
    <NotifyGuests
      // No edit counted the households: the lead says who is told instead.
      offer={{ slug, households: 0 }}
      title={t('tell.heading')}
      lead={t('tell.lead')}
      back={{ label: t('tell.back'), onClick: onBack }}
    />
  );
}
