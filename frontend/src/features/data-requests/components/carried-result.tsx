import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { useLeaveGuardWhen, WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { saveFile } from '@/ui/save-file';

import { privateFile } from '../api';
import { ERASURE_COUNTS } from '../read';
import type { Carried } from '../types';

type ExportResult = Extract<Carried, { kind: 'export' }>;

/** The file's name holds the request's reference and nobody's address. */
export function saveExport({ reference, result }: ExportResult): void {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  saveFile(blob, `data-request-${reference}.json`);
}

function PrivateFiles({ carried }: { carried: ExportResult }) {
  const { t } = useTranslation('data-requests');
  const [hasFailed, setHasFailed] = useState(false);
  const save = async (mediaId: string, position: number) => {
    setHasFailed(false);
    try {
      const blob = await privateFile(browserSession().api, carried.reference, mediaId);
      saveFile(blob, `data-request-${carried.reference}-file-${position}.bin`);
    } catch (error) {
      if (!isApiError(error)) throw error;
      setHasFailed(true);
    }
  };
  const total = carried.files.length;
  return (
    <>
      {carried.files.map(({ mediaId }, index) => (
        <Button
          key={mediaId}
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          onClick={() => void save(mediaId, index + 1)}
        >
          {t('export.saveFile', { position: index + 1, total })}
        </Button>
      ))}
      {hasFailed ? (
        <p role="alert" className="text-destructive m-0 text-sm">
          {t('export.fileFailed')}
        </p>
      ) : null}
    </>
  );
}

/**
 * What an export answered, the only copy there is (FR-128): saved as soon as it came, and held in this
 * page's memory to save again, which the leave guard protects. Nothing else keeps it.
 */
function ExportHeld({ carried }: { carried: ExportResult }) {
  const { t } = useTranslation('data-requests');
  useLeaveGuardWhen(true);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0">{t('export.saved')}</p>
      <Button
        variant="outline"
        className={`${WRAPPING_BUTTON} self-start`}
        onClick={() => saveExport(carried)}
      >
        {t('export.saveAgain')}
      </Button>
      <PrivateFiles carried={carried} />
    </div>
  );
}

const KNOWN_COUNTS: ReadonlySet<string> = new Set(ERASURE_COUNTS);

function ErasureReport({ carried }: { carried: Extract<Carried, { kind: 'erasure' }> }) {
  const { t } = useTranslation('data-requests');
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('erase.reportTitle')}
      </h2>
      {carried.isRecoveryPending ? <p className="m-0">{t('erase.recoveryPending')}</p> : null}
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
        {carried.counts.map(([name, count]) => (
          <li key={name}>
            {KNOWN_COUNTS.has(name) ? (
              t(`erase.count.${name}` as 'erase.count.guestsAnonymised', { count })
            ) : (
              <span lang="en">{`${name}: ${count}`}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CarriedResult({ carried }: { carried: Carried }) {
  return carried.kind === 'export' ? (
    <ExportHeld carried={carried} />
  ) : (
    <ErasureReport carried={carried} />
  );
}
