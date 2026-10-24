import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { isApiError } from '@/api/errors';
import { APP_PATHS } from '@/route-paths';

/**
 * An event page that could not load, inside the app's frame. The backend answers 403 both for an
 * event that does not exist and for one the account is not on (docs/BACKLOG.md §4), so the two
 * read the same. Anything else shows the request id, which maps a report to the request.
 */
export function EventUnavailable({ error }: { error: unknown }) {
  const { t } = useTranslation('events');
  const { t: common } = useTranslation('common');
  const isMissing = isApiError(error) && (error.status === 403 || error.status === 404);
  const requestId = isApiError(error) && !isMissing ? error.requestId : undefined;
  return (
    <section className="flex max-w-[34rem] flex-col gap-4">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
        {isMissing ? t('unavailable.title') : common('error.title')}
      </h1>
      <p className="m-0">{isMissing ? t('unavailable.body') : t('unavailable.failed')}</p>
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
