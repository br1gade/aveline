import { useTranslation } from 'react-i18next';

import { imageSource } from '@/features/invitation-renderer';
import type { Language } from '@/lib/i18n';
import { LanguageSwitcher, Notice } from '@/ui';

import type { PublicEvent } from '../types';
import { EventFacts } from './event-facts';
import { PublicFrame } from './public-frame';
import { TicketPicker } from './ticket-picker';

/** The host's body text as paragraphs, split on blank lines; never markup (design PD-78). */
function paragraphs(body: string | null): string[] {
  return (body ?? '')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function Hero({ event }: { event: PublicEvent }) {
  if (!event.heroImage) return null;
  const source = imageSource(event.heroImage);
  return (
    <img
      {...source}
      sizes="(min-width: 40rem) 40rem, 100vw"
      alt={event.heroImage.altText ?? ''}
      className="bg-sand aspect-[4/3] h-auto w-full object-cover"
    />
  );
}

function TicketsBody({ event, isSalesClosed }: { event: PublicEvent; isSalesClosed: boolean }) {
  const { t } = useTranslation('public-event');
  if (isSalesClosed) return <Notice>{t('tickets.closed')}</Notice>;
  if (event.ticketTypes.length === 0) return <Notice>{t('tickets.none')}</Notice>;
  return <TicketPicker event={event} />;
}

export interface EventPageProps {
  event: PublicEvent;
  isSalesClosed: boolean;
  languageHref: (language: Language) => string;
}

/**
 * A public event's announcement (docs/API.md §5, design PD-78): the headline, the picture, when
 * and where, the host's words, then the tickets. Rendered on the server in the language the
 * response names, so a link preview and the first paint carry everything.
 */
export function EventPage({ event, isSalesClosed, languageHref }: EventPageProps) {
  const { t } = useTranslation('public-event');
  return (
    <PublicFrame>
      <header className="grid gap-4">
        <div className="flex justify-end">
          <LanguageSwitcher
            current={event.locale}
            available={event.availableLocales}
            hrefFor={languageHref}
            align="end"
          />
        </div>
        <h1 className="type-display-l text-heading m-0">{event.headline ?? t('untitled')}</h1>
        {event.summary ? <p className="type-lead m-0">{event.summary}</p> : null}
      </header>
      <Hero event={event} />
      <EventFacts event={event} />
      {paragraphs(event.body).map((paragraph, index) => (
        <p key={index} className="m-0 whitespace-pre-line">
          {paragraph}
        </p>
      ))}
      <section aria-labelledby="tickets-heading" className="grid gap-6">
        <h2 id="tickets-heading" className="type-heading-1 text-heading m-0">
          {t('tickets.heading')}
        </h2>
        <TicketsBody event={event} isSalesClosed={isSalesClosed} />
      </section>
    </PublicFrame>
  );
}
