import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { isApiError } from '@/api/errors';
import { APP_PATHS } from '@/route-paths';

type Reason = 'missing' | 'rateLimited' | 'failed';

function reasonOf(error: unknown): Reason {
  if (!isApiError(error)) return 'failed';
  if (error.status === 403 || error.status === 404) return 'missing';
  return error.status === 429 ? 'rateLimited' : 'failed';
}

/**
 * An event page that could not load, inside the app's frame. The backend answers 403 both for an
 * event that does not exist and for one the account is not on (docs/BACKLOG.md §4), so the two
 * read the same. Too many requests asks for a minute's wait. Anything else shows the request id,
 * which maps a report to the request.
 */
export function EventUnavailable({ error }: { error: unknown }) {
  const { t } = useTranslation('events');
  const { t: common } = useTranslation('common');
  const reason = reasonOf(error);
  const requestId = isApiError(error) && reason === 'failed' ? error.requestId : undefined;
  return (
    <section className="flex max-w-[34rem] flex-col gap-4">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
        {reason === 'missing' ? t('unavailable.title') : common('error.title')}
      </h1>
      <p className="m-0">
        {t(reason === 'missing' ? 'unavailable.body' : `unavailable.${reason}`)}
      </p>
      {requestId ? (
        <p className="text-muted-foreground m-0 text-sm">
          {common('error.reference', { requestId })}
        </p>
      ) : null}
      <Link
        to={APP_PATHS.app}
        className="text-primary self-start underline underline-offset-4 hover:no-underline"
      >
        {t('unavailable.back')}
      </Link>
    </section>
  );
}
