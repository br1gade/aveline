import { useTranslation } from 'react-i18next';

import type { Loaded } from '../load';

/** Why a part of the page is missing: this role may not see it, or it failed to load. */
export function LoadedProblem({
  loaded,
  refusedText,
}: {
  loaded: Exclude<Loaded<unknown>, { kind: 'ready' }>;
  refusedText: string;
}) {
  const { t } = useTranslation('common');
  if (loaded.kind === 'refused') return <p className="text-muted-foreground m-0">{refusedText}</p>;
  const { problem } = loaded;
  return (
    <p className="text-muted-foreground m-0">
      {problem.code === 'refused' ? t('problems.server') : t(`problems.${problem.code}`)}
      {problem.code === 'server' && problem.requestId ? (
        <span className="block text-sm">
          {t('error.reference', { requestId: problem.requestId })}
        </span>
      ) : null}
    </p>
  );
}
