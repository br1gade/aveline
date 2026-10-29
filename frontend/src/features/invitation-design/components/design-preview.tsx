import { useMemo } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { InvitationPage } from '@/features/invitation-renderer';
import { createI18n, isLanguage, SOURCE_LANGUAGE } from '@/lib/i18n';

import type { DesignPreviewData } from '../load';
import { designLookPath, designPath, designPreviewPath } from '../paths';
import type { Preview } from '../types';
import { TEXT_LINK } from './design-parts';

/** Which template the preview shows, by name; another than the invitation's is said so. */
function useTemplateLine(data: DesignPreviewData): string | null {
  const { t } = useTranslation('design');
  const { request, design, templates } = data;
  const key = request.templateKey;
  if (!key || key === design?.template.key) return null;
  const template =
    templates.kind === 'ready' ? templates.value.find((item) => item.key === key) : undefined;
  return t('preview.otherTemplate', { name: template?.name ?? key });
}

/**
 * Above the invitation, in the host's own language: what this is, the way back, and whether it
 * shows the invitation's words or the template's sample text.
 */
function PreviewBar({ data }: { data: DesignPreviewData }) {
  const { t } = useTranslation('design');
  const eventId = data.event.id;
  const templateLine = useTemplateLine(data);
  return (
    <section
      aria-label={t('preview.bar')}
      className="bg-background text-foreground border-border flex flex-col gap-2 border-b px-4 py-3 text-[15px] leading-[22px] sm:px-8"
    >
      <Link to={designPath(eventId)} className={TEXT_LINK}>
        {t('back.design')}
      </Link>
      <p className="m-0 font-medium">{t('preview.lead')}</p>
      {data.request.isSample ? <p className="m-0 text-sm">{t('preview.sample')}</p> : null}
      {templateLine ? (
        <p className="m-0 text-sm">
          {templateLine}{' '}
          <Link to={designLookPath(eventId)} className={TEXT_LINK}>
            {t('preview.chooseIt')}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/**
 * The invitation as guests read it: in its own language, with the renderer's own words in that
 * language too, whatever the host's interface is in (design PD-59).
 */
function PreviewPage({ preview, data }: { preview: Preview; data: DesignPreviewData }) {
  const language = isLanguage(preview.locale) ? preview.locale : SOURCE_LANGUAGE;
  const i18n = useMemo(() => createI18n(language), [language]);
  const { request } = data;
  const languageHref = (locale: string) => designPreviewPath(data.event.id, { ...request, locale });
  return (
    <I18nextProvider i18n={i18n}>
      <div lang={preview.locale}>
        <InvitationPage invitation={{ ...preview, isPreview: true }} languageHref={languageHref} />
      </div>
    </I18nextProvider>
  );
}

/**
 * The saved design through the invitation's own renderer, never a second one (docs/API.md §6,
 * "Previewing a template"; design PD-59). The backend builds the payload as for a guest's page,
 * with no guest, and nothing can be answered.
 */
export function DesignPreview({ data }: { data: DesignPreviewData }) {
  const { t } = useTranslation('design');
  return (
    <>
      <PreviewBar data={data} />
      {data.preview ? (
        <PreviewPage preview={data.preview} data={data} />
      ) : (
        <main className="mx-auto max-w-[56rem] px-4 py-8 sm:px-8">
          <p className="m-0">{t('noInvitation')}</p>
        </main>
      )}
    </>
  );
}
