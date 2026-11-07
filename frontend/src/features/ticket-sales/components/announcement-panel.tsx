import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { formatEventDate, formatEventTime } from '@/lib/time';
import { EXTERNAL_LINK, Icon } from '@/ui';
import { ProblemAlert, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { publishListing, unpublishListing } from '../api';
import type { TicketSalesData } from '../load';
import { announcementPath, publicEventPath } from '../paths';
import { inLanguage } from '../read';
import { publishBlockers, type PublishBlocker } from '../refusals';
import { HEADING, LINK, PANEL } from './shared';
import { VISIBILITY_HEADING_ID } from './visibility-panel';

/** Where a blocker is fixed: who can find the event, or the announcement's own page. */
function BlockerFix({ kind, eventId }: { kind: PublishBlocker['kind']; eventId: string }) {
  const { t } = useTranslation('ticket-sales');
  if (kind === 'private') {
    return (
      <a href={`#${VISIBILITY_HEADING_ID}`} className={LINK}>
        {t('blockers.fixVisibility')}
      </a>
    );
  }
  if (kind !== 'headline' && kind !== 'noListing') return null;
  return (
    <Link to={announcementPath(eventId)} className={LINK}>
      {t('blockers.fixAnnouncement')}
    </Link>
  );
}

/** Each blocker in our words with its fix; one we do not know as it came, marked English. */
function Blockers({ blockers, eventId }: { blockers: PublishBlocker[]; eventId: string }) {
  const { t } = useTranslation('ticket-sales');
  return (
    <div role="alert" className="text-destructive flex flex-col gap-1 text-sm">
      <p className="m-0 font-medium">{t('blockers.heading')}</p>
      <ul className="m-0 pl-5">
        {blockers.map((blocker, index) => (
          <li key={index}>
            {blocker.kind === 'other' ? (
              <span lang="en">{blocker.sentence}</span>
            ) : (
              <>
                {t(`blockers.${blocker.kind}`)} <BlockerFix kind={blocker.kind} eventId={eventId} />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useStateLine(data: TicketSalesData): string {
  const { t, i18n } = useTranslation('ticket-sales');
  const { listing, event } = data;
  if (!listing) return t('announcement.none');
  if (!listing.publishedAt) return t('announcement.draft');
  const zone = { timeZone: event.timezone, locale: i18n.language };
  return t('announcement.published', {
    date: formatEventDate(listing.publishedAt, zone),
    time: formatEventTime(listing.publishedAt, zone),
  });
}

/** Publishing and taking down: a refused publish lists every reason at once (FR-69). */
function usePublishing(data: TicketSalesData, page: PageActions) {
  const { t } = useTranslation('ticket-sales');
  const [isBusy, setIsBusy] = useState(false);
  const [blockers, setBlockers] = useState<PublishBlocker[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const act = async (isPublishing: boolean) => {
    setBlockers([]);
    setProblem(null);
    setIsBusy(true);
    try {
      const { api } = browserSession();
      const eventId = data.event.id;
      await (isPublishing ? publishListing(api, eventId) : unpublishListing(api, eventId));
      await page.done(t(isPublishing ? 'announcement.didPublish' : 'announcement.didUnpublish'));
    } catch (error) {
      const found = isPublishing ? publishBlockers(error) : [];
      if (found.length > 0) setBlockers(found);
      else setProblem(problemFrom(error));
    } finally {
      setIsBusy(false);
    }
  };
  return { isBusy, blockers, problem, act };
}

function PublicLink({ slug }: { slug: string }) {
  const { t } = useTranslation('ticket-sales');
  return (
    <a href={publicEventPath(slug)} {...EXTERNAL_LINK} className={LINK}>
      {t('announcement.open', { path: publicEventPath(slug) })}
      <Icon name="external-link" size={16} className="ml-1 inline align-[-3px]" />
      <span className="sr-only">{t('newTab')}</span>
    </a>
  );
}

function Actions({
  data,
  publishing,
}: {
  data: TicketSalesData;
  publishing: ReturnType<typeof usePublishing>;
}) {
  const { t } = useTranslation('ticket-sales');
  const { listing, event } = data;
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link to={announcementPath(event.id)}>
          {t(listing ? 'announcement.edit' : 'announcement.write')}
        </Link>
      </Button>
      {listing && !listing.publishedAt ? (
        <Button disabled={publishing.isBusy} onClick={() => void publishing.act(true)}>
          {t('announcement.publish')}
        </Button>
      ) : null}
      {listing?.publishedAt ? (
        <Button
          variant="outline"
          disabled={publishing.isBusy}
          onClick={() => void publishing.act(false)}
        >
          {t('announcement.unpublish')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The announcement, the public page that sells the tickets (design PD-84): whether it is written
 * and public, its address, and publishing it, each refusal with its fix.
 */
export function AnnouncementPanel({ data, page }: { data: TicketSalesData; page: PageActions }) {
  const { t, i18n } = useTranslation('ticket-sales');
  const { listing, event } = data;
  const publishing = usePublishing(data, page);
  const stateLine = useStateLine(data);
  const headline = listing
    ? inLanguage(listing.headline, i18n.language, event.defaultLocale)
    : null;
  return (
    <section aria-labelledby="announcement-heading" className={PANEL}>
      <h2 id="announcement-heading" className={HEADING}>
        {t('announcement.heading')}
      </h2>
      <p className="m-0 text-sm">{t('announcement.lead')}</p>
      <p className="m-0 font-medium">{stateLine}</p>
      {headline ? <p className="m-0">{headline}</p> : null}
      {listing?.publishedAt ? <PublicLink slug={listing.slug} /> : null}
      {publishing.blockers.length > 0 ? (
        <Blockers blockers={publishing.blockers} eventId={event.id} />
      ) : null}
      {publishing.problem ? (
        <ProblemAlert
          problem={publishing.problem}
          refused={(status) => t(status === 403 ? 'forbidden' : 'refused')}
        />
      ) : null}
      <Actions data={data} publishing={publishing} />
    </section>
  );
}
