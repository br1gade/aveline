import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import { APP_PATHS } from '@/route-paths';

import type { Blocker, BlockerCode } from '../blockers';

interface Fix {
  to: string;
  label: 'venueFix' | 'startedFix' | 'rsvpFix';
}

/** Where each known blocker is fixed. The reply section is shown, or added, on its design page. */
function fixOf(code: BlockerCode, eventId: string): Fix {
  if (code === 'venue') {
    return { to: generatePath(APP_PATHS.newVenue, { eventId }), label: 'venueFix' };
  }
  if (code === 'started') {
    return { to: generatePath(APP_PATHS.editEvent, { eventId }), label: 'startedFix' };
  }
  return {
    to: generatePath(APP_PATHS.designSection, { eventId, blockType: 'RSVP' }),
    label: 'rsvpFix',
  };
}

function KnownBlocker({ code, eventId }: { code: BlockerCode; eventId: string }) {
  const { t } = useTranslation('sending');
  const fix = fixOf(code, eventId);
  return (
    <li className="flex flex-col gap-1">
      <span>{t(`blockers.${code}`)}</span>
      <Link
        to={fix.to}
        className="text-primary self-start underline underline-offset-4 hover:no-underline"
      >
        {t(`blockers.${fix.label}`)}
      </Link>
    </li>
  );
}

/**
 * Everything that still blocks publishing, at once (docs/API.md §6). The three the backend has
 * today are said in the page's language with a link to their fix; anything else as it came, in
 * English (design PD-49, FR-32).
 */
export function BlockerList({
  blockers,
  eventId,
}: {
  blockers: readonly Blocker[];
  eventId: string;
}) {
  const { t, i18n } = useTranslation('sending');
  const hasEnglish = blockers.some((blocker) => blocker.kind === 'other');
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5">
        {blockers.map((blocker, position) =>
          blocker.kind === 'known' ? (
            <KnownBlocker key={position} code={blocker.code} eventId={eventId} />
          ) : (
            <li key={position} lang="en">
              {blocker.message}
            </li>
          ),
        )}
      </ul>
      {hasEnglish && i18n.language !== 'en' ? (
        <p className="text-muted-foreground m-0 text-sm">{t('blockers.inEnglish')}</p>
      ) : null}
    </div>
  );
}
