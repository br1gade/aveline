import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFormState, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { loaded, type Loaded } from '@/api/loaded';
import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import type { BlockEditing, BlockType, Invitation } from '@/features/invitation-renderer';
import { LoadedProblem } from '@/features/sending';
import { useLanguageName } from '@/lib/i18n';
import { SelectField } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { previewDraft } from '../api';
import { draftMessage, readDraftMessage } from '../draft-message';
import { sectionFormValues, type SectionFormValues } from '../form-model';
import { sectionEdit } from '../payload';
import { designDraftPreviewPath } from '../paths';
import type { Design, DesignBlock, Preview } from '../types';

export interface DraftPreviewProps {
  form: UseFormReturn<SectionFormValues>;
  design: Design;
  block: DesignBlock;
  type: BlockType;
  editing: BlockEditing;
  /** Marks on the form what a `400` names, as saving does. */
  onRefused: (error: unknown) => void;
}

/** What was last drawn, and the form's values it was drawn from. */
interface Drawn {
  values: string;
  page: Loaded<Preview>;
}

/**
 * Asks the backend to draw the form as it stands: on opening, on a new language and on press, never
 * as the host types (design PD-153). An answer to an older request is dropped.
 */
function useDrawnDraft(props: DraftPreviewProps) {
  const { form, design, block, type, editing, onRefused } = props;
  const [locale, setLocale] = useState(design.event.defaultLocale);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [page, setPage] = useState<Invitation | null>(null);
  const [isDrawing, setIsDrawing] = useState(true);
  const latest = useRef(0);
  const baseline = useMemo(
    () => sectionFormValues(block, editing, design.event.locales),
    [block, editing, design.event.locales],
  );
  const draw = useCallback(() => {
    const request = ++latest.current;
    const values = form.getValues();
    const edit = sectionEdit(block, editing, baseline, values);
    const drawing = previewDraft(browserSession().api, { slug: design.slug, locale }, type, edit);
    // Only the latest request marks the form: an older 400 may name a field corrected since.
    const marked = drawing.catch((error: unknown) => {
      const isLatest = request === latest.current;
      if (isLatest && isApiError(error) && error.status === 400) onRefused(error);
      throw error;
    });
    void loaded(marked).then((answer) => {
      if (request !== latest.current) return;
      setIsDrawing(false);
      setDrawn({ values: JSON.stringify(values), page: answer });
      // A refused drawing leaves the last one standing.
      if (answer.kind === 'ready') setPage(answer.value);
    });
  }, [form, block, editing, baseline, design.slug, locale, type, onRefused]);
  // Every input but the locale stays put while the host types, so this draws on opening and on a
  // new language; after a save the section is read again, and drawn as saved.
  useEffect(draw, [draw]);
  const chooseLocale = (chosen: string) => {
    setIsDrawing(true);
    setLocale(chosen);
  };
  const redraw = () => {
    setIsDrawing(true);
    draw();
  };
  return { locale, chooseLocale, drawn, page, isDrawing, redraw };
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

/** Why nothing new is drawn: a `400` is marked on the form; anything else is said here. */
function DrawProblem({ page }: { page: Exclude<Loaded<Preview>, { kind: 'ready' }> }) {
  const { t } = useTranslation('design');
  if (page.kind === 'failed' && page.problem.code === 'refused' && page.problem.status === 400) {
    return <p className="m-0 text-sm">{t('draftPreview.refused')}</p>;
  }
  return <LoadedProblem loaded={page} refusedText={t('draftPreview.failed')} />;
}

/** Whether the frame shows the form as it stands, and whether that is saved. */
function DrawnStatus({ form, drawn }: Pick<DraftPreviewProps, 'form'> & { drawn: Drawn }) {
  const { t } = useTranslation('design');
  useWatch({ control: form.control });
  const { isDirty } = useFormState({ control: form.control });
  const isBehind = drawn.values !== JSON.stringify(form.getValues());
  const savedOrNot = isDirty ? 'unsaved' : 'saved';
  return (
    <p className="m-0 text-sm" aria-live="polite">
      {t(`draftPreview.${isBehind ? 'behind' : savedOrNot}`)}
    </p>
  );
}

/** The backend's drawing of the form in the chosen language, in a phone-wide frame. */
function DraftFrame(props: DraftPreviewProps) {
  const { t } = useTranslation('design');
  const { design, block, form } = props;
  const { locale, chooseLocale, drawn, page, isDrawing, redraw } = useDrawnDraft(props);
  const frame = useFramedDraft(page);
  return (
    <>
      <LanguageChoice locales={design.event.locales} value={locale} onChange={chooseLocale} />
      <Button type="button" variant="outline" className="self-start" onClick={redraw}>
        {t('draftPreview.refresh')}
      </Button>
      {isDrawing ? <p className="m-0 text-sm">{t('draftPreview.loading')}</p> : null}
      {!isDrawing && drawn?.page.kind === 'ready' ? (
        <DrawnStatus form={form} drawn={drawn} />
      ) : null}
      {!isDrawing && drawn && drawn.page.kind !== 'ready' ? (
        <DrawProblem page={drawn.page} />
      ) : null}
      {block.enabled ? null : <p className="m-0 text-sm">{t('draftPreview.hidden')}</p>}
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
 * section's form drawn by the backend (FR-120), shown in a frame so the renderer lays it out at a
 * phone's width whatever the screen.
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
