import { useDeferredValue, useEffect, useId, useRef, useState } from 'react';
import { useFormState, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { loaded, type Loaded } from '@/api/loaded';
import { browserSession } from '@/api/session';
import type { BlockEditing, Invitation } from '@/features/invitation-renderer';
import { LoadedProblem } from '@/features/sending';
import { useLanguageName } from '@/lib/i18n';
import { SelectField } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { previewInvitation } from '../api';
import { draftMessage, readDraftMessage } from '../draft-message';
import { draftInvitation } from '../draft-preview';
import { designDraftPreviewPath } from '../paths';
import type { SectionFormValues } from '../form-model';
import type { Design, DesignBlock, LibraryItem, Preview } from '../types';

export interface DraftPreviewProps {
  form: UseFormReturn<SectionFormValues>;
  design: Design;
  block: DesignBlock;
  editing: BlockEditing;
  layouts: readonly string[] | null;
  library: Loaded<LibraryItem[]>;
}

/** The saved page in one language, read when asked for; `null` while it is read. */
function useSavedPreview(slug: string, locale: string): Loaded<Preview> | null {
  const [read, setRead] = useState<{ locale: string; page: Loaded<Preview> } | null>(null);
  useEffect(() => {
    let isCurrent = true;
    void loaded(previewInvitation(browserSession().api, slug, { locale })).then((page) => {
      if (isCurrent) setRead({ locale, page });
    });
    return () => {
      isCurrent = false;
    };
  }, [slug, locale]);
  return read?.locale === locale ? read.page : null;
}

/** Sends each new draft to the frame once it says it is ready; the frame's own window only. */
function useFramedDraft(draft: Invitation | null) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const source = frame.current?.contentWindow ?? null;
      const message = readDraftMessage(event, { origin: window.location.origin, source });
      if (message?.kind === 'ready') setIsReady(true);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);
  useEffect(() => {
    if (isReady && draft) {
      frame.current?.contentWindow?.postMessage(draftMessage(draft), window.location.origin);
    }
  }, [isReady, draft]);
  return frame;
}

function LanguageChoice({
  locales,
  value,
  onChange,
}: {
  locales: readonly string[];
  value: string;
  onChange: (locale: string) => void;
}) {
  const { t } = useTranslation('design');
  const languageName = useLanguageName();
  if (locales.length < 2) return null;
  return (
    <SelectField
      label={t('draftPreview.language')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {locales.map((locale) => (
        <NativeSelectOption key={locale} value={locale}>
          {languageName(locale)}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

/** The form's values over the saved page in the chosen language, drawn in a phone-wide frame. */
function DraftFrame({ form, design, block, editing, layouts, library }: DraftPreviewProps) {
  const { t } = useTranslation('design');
  const [locale, setLocale] = useState(design.event.defaultLocale);
  const saved = useSavedPreview(design.slug, locale);
  useWatch({ control: form.control });
  const { isDirty } = useFormState({ control: form.control });
  const draft =
    saved?.kind === 'ready'
      ? draftInvitation(saved.value, {
          block,
          editing,
          values: form.getValues(),
          layouts,
          library: library.kind === 'ready' ? library.value : [],
          order: design.blocks.map(({ type }) => type),
          defaultLocale: design.event.defaultLocale,
        })
      : null;
  const frame = useFramedDraft(useDeferredValue(draft));
  return (
    <>
      <LanguageChoice locales={design.event.locales} value={locale} onChange={setLocale} />
      <p className="m-0 text-sm" aria-live="polite">
        {t(isDirty ? 'draftPreview.unsaved' : 'draftPreview.saved')}
      </p>
      {block.enabled ? null : <p className="m-0 text-sm">{t('draftPreview.hidden')}</p>}
      {saved === null ? <p className="m-0 text-sm">{t('draftPreview.loading')}</p> : null}
      {saved && saved.kind !== 'ready' ? (
        <LoadedProblem loaded={saved} refusedText={t('draftPreview.failed')} />
      ) : null}
      <iframe
        ref={frame}
        title={t('draftPreview.frameTitle')}
        src={designDraftPreviewPath(design.event.id)}
        className="border-border h-[46rem] w-[390px] max-w-full border"
      />
    </>
  );
}

/**
 * A section's unsaved edits, as guests would see them (design PD-153): beside the form on a wide
 * screen, under it on a phone, shown when asked for. The page is the saved preview with this
 * section's form laid over it, in the browser (FR-120), drawn in a frame so the renderer lays it
 * out at a phone's width whatever the screen.
 */
export function DraftPreview(props: DraftPreviewProps) {
  const { t } = useTranslation('design');
  const headingId = useId();
  const [isShown, setIsShown] = useState(false);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start"
    >
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('draftPreview.title')}
      </h2>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        aria-expanded={isShown}
        onClick={() => setIsShown((shown) => !shown)}
      >
        {t(isShown ? 'draftPreview.hide' : 'draftPreview.show')}
      </Button>
      {isShown ? <DraftFrame {...props} /> : null}
    </section>
  );
}
