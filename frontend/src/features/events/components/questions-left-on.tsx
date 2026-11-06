import { useTranslation } from 'react-i18next';
import { generatePath, Link, useLocation } from 'react-router';

import { APP_PATHS } from '@/route-paths';

import { questionsLeftOnFor } from '../new-invitation';

/**
 * Said on the page a new event or invitation opens on, when drink and song request couldn't
 * be switched off (PD-179). It lives in the router's state alone, on that page's history entry: a
 * reload of it shows the line again, and a pasted or shared address never does.
 */
export function QuestionsLeftOnNotice() {
  const { t } = useTranslation('events');
  const eventId = questionsLeftOnFor(useLocation().state);
  if (!eventId) return null;
  return (
    <div
      role="status"
      className="border-border flex max-w-[40rem] flex-col items-start border-l-2 pl-3"
    >
      <p className="m-0">{t('questionsLeftOn.body')}</p>
      <Link
        to={generatePath(APP_PATHS.designQuestions, { eventId })}
        className="text-primary inline-flex min-h-11 items-center underline underline-offset-4 hover:no-underline"
      >
        {t('questionsLeftOn.link')}
      </Link>
    </div>
  );
}
