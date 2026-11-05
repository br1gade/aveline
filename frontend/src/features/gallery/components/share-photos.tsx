import { useId, useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { ApiClient } from '@/api/client';
import { Button, Icon, useIsHydrated } from '@/ui';
import { TextArea } from '@/ui/form';

import { uploadPhoto, type GalleryLink } from '../api';
import {
  CAPTION_LIMIT,
  captionProblem,
  captionToSend,
  choiceProblem,
  PHOTO_ACCEPT,
  chosenPhotoProblem,
  PHOTOS_PER_GUEST,
} from '../rules';
import type { GalleryPhoto } from '../types';
import { shrinkPhoto } from '../shrink';
import { sendBatch, stillChosen, type BatchResult } from '../upload-batch';
import { BatchSummary } from './batch-summary';

type ChoiceError = 'none' | 'tooMany' | 'allRefused';

interface Sending {
  current: number;
  total: number;
}

/** A batch once sent: the files it took, and what became of each. */
export interface SentBatch {
  files: File[];
  result: BatchResult;
}

type ChooseEvent = ChangeEvent<HTMLInputElement>;

interface ShareProps {
  api: ApiClient;
  link: GalleryLink;
  onShared: (photos: GalleryPhoto[]) => void;
}

function useShare({ api, link, onShared }: ShareProps) {
  const [sending, setSending] = useState<Sending | null>(null);
  const [batch, setBatch] = useState<SentBatch | null>(null);
  const isStopped = useRef(false);
  const send = async (files: File[], caption: string | undefined) => {
    isStopped.current = false;
    setBatch(null);
    setSending({ current: 1, total: files.length });
    const result = await sendBatch(files, (file) => uploadPhoto(api, link, file, caption), {
      shouldStop: () => isStopped.current,
      onSending: (index) => setSending({ current: index + 1, total: files.length }),
      shrink: shrinkPhoto,
    });
    setSending(null);
    setBatch({ files, result });
    onShared(
      result.outcomes.flatMap((outcome) => (outcome.kind === 'shared' ? [outcome.photo] : [])),
    );
    return result;
  };
  const stop = () => {
    isStopped.current = true;
  };
  return { sending, batch, send, stop };
}

function choiceErrorOf(files: readonly File[]): ChoiceError | null {
  const problem = choiceProblem(files.length);
  if (problem) return problem;
  return files.every((file) => chosenPhotoProblem(file)) ? 'allRefused' : null;
}

interface PickerProps {
  id: string;
  files: readonly File[];
  error: ChoiceError | null;
  onChange: (event: ChooseEvent) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** The browser's own file input, several at once, with each file's own problem named. */
function PhotoPicker({ id, files, error, onChange, inputRef }: PickerProps) {
  const { t } = useTranslation('gallery');
  const describedBy = [`${id}-help`, error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="text-ink text-sm leading-5 font-medium">
        {t('share.choose')}
      </label>
      <input
        ref={inputRef}
        id={id}
        name="photos"
        type="file"
        multiple
        accept={PHOTO_ACCEPT}
        onChange={onChange}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className="text-ink file:border-action file:text-action min-h-(--target-min) max-w-full text-sm file:mr-3 file:min-h-(--target-min) file:cursor-pointer file:border file:bg-transparent file:px-4"
      />
      <p id={`${id}-help`} className="text-ink-muted m-0 text-sm leading-5">
        {t('share.help', { limit: PHOTOS_PER_GUEST })}
      </p>
      {error ? (
        <p id={`${id}-error`} className="text-error m-0 flex items-start gap-2 text-sm leading-5">
          <Icon name="circle-alert" size={18} className="mt-px" />
          {t(`share.errors.${error}`, { limit: PHOTOS_PER_GUEST })}
        </p>
      ) : null}
      {files.length > 0 ? <ChosenFiles files={files} /> : null}
    </div>
  );
}

function ChosenFiles({ files }: { files: readonly File[] }) {
  const { t } = useTranslation('gallery');
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-sm leading-5">
      {files.map((file, index) => {
        const problem = chosenPhotoProblem(file);
        return (
          <li key={`${index}-${file.name}`} className="flex flex-wrap gap-x-2">
            <bdi className="break-all">{file.name}</bdi>
            <span className={problem ? 'text-error' : 'text-ink-muted'}>
              {problem ? t(`share.problems.${problem}`) : t('share.ready')}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface CaptionProps {
  value: string;
  onChange: (value: string) => void;
  /** The server refused the caption last sent (a 400 naming it). */
  isRefused: boolean;
}

function CaptionField({ value, onChange, isRefused }: CaptionProps) {
  const { t } = useTranslation('gallery');
  const problem = captionProblem(value) ?? (isRefused ? 'refused' : null);
  return (
    <TextArea
      label={t('share.caption')}
      optionalText={t('share.optional')}
      help={t('share.captionHelp')}
      error={problem ? t(`share.captionErrors.${problem}`, { limit: CAPTION_LIMIT }) : undefined}
      counter={t('share.counter', { used: value.trim().length, limit: CAPTION_LIMIT })}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={2}
    />
  );
}

interface ActionsProps {
  sending: Sending | null;
  sendable: number;
  isHydrated: boolean;
  onStop: () => void;
}

/** Share, Stop while sending, and the progress, said as it goes. */
function ShareActions({ sending, sendable, isHydrated, onStop }: ActionsProps) {
  const { t } = useTranslation('gallery');
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="submit"
        disabled={!isHydrated || sending !== null}
        aria-busy={sending !== null || undefined}
      >
        {sendable > 0 ? t('share.submit', { count: sendable }) : t('share.submitNone')}
      </Button>
      {sending ? (
        <Button variant="secondary" onClick={onStop}>
          {t('share.stop')}
        </Button>
      ) : null}
      <p role="status" className="text-ink m-0 text-sm">
        {sending ? t('share.sending', { current: sending.current, total: sending.total }) : ''}
      </p>
    </div>
  );
}

/** The form's own state: what is chosen, its caption, and what the checks or the server said. */
function useChoice() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [choiceError, setChoiceError] = useState<ChoiceError | null>(null);
  const [isCaptionRefused, setIsCaptionRefused] = useState(false);
  const choose = (event: ChooseEvent) => {
    setFiles(Array.from(event.target.files ?? []));
    setChoiceError(null);
    setIsCaptionRefused(false);
  };
  const editCaption = (value: string) => {
    setCaption(value);
    setIsCaptionRefused(false);
  };
  /** After a batch: only what was not sent stays chosen (`stillChosen`), so nothing goes twice. */
  const settle = (sent: File[], result: BatchResult) => {
    const kept = stillChosen(sent, result);
    setFiles(kept);
    setIsCaptionRefused(
      result.outcomes.some((outcome) => outcome.kind === 'refused' && outcome.reason === 'caption'),
    );
    if (kept.length === 0) setCaption('');
    if (inputRef.current) inputRef.current.value = '';
  };
  return {
    inputRef,
    files,
    caption,
    choiceError,
    setChoiceError,
    isCaptionRefused,
    choose,
    editCaption,
    settle,
  };
}

/**
 * Sharing photos (design PD-63): several chosen at once, each checked before sending, sent one
 * after another with the progress said; a caption when one photo is chosen. The form posts and
 * its button waits for hydration (PD-41), so a choice never reaches the link's address. "Send the
 * rest" sends what is still chosen, as the form's own button does.
 */
export function SharePhotos(props: ShareProps) {
  const { t } = useTranslation('gallery');
  const id = useId();
  const isHydrated = useIsHydrated();
  const choice = useChoice();
  const { files, caption } = choice;
  const { sending, batch, send, stop } = useShare(props);
  const sendable = files.filter((file) => !chosenPhotoProblem(file)).length;

  const shareChosen = async () => {
    const problem = choiceErrorOf(files);
    choice.setChoiceError(problem);
    if (problem || (files.length === 1 && captionProblem(caption))) return;
    const result = await send(files, files.length === 1 ? captionToSend(caption) : undefined);
    choice.settle(files, result);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void shareChosen();
  };

  return (
    // `method="post"`: were the browser ever to send it itself, the photos go in a body (PD-41).
    <form method="post" noValidate onSubmit={submit} className="grid gap-4">
      <PhotoPicker
        id={id}
        files={files}
        error={choice.choiceError}
        onChange={choice.choose}
        inputRef={choice.inputRef}
      />
      {files.length === 1 ? (
        <CaptionField
          value={caption}
          onChange={choice.editCaption}
          isRefused={choice.isCaptionRefused}
        />
      ) : null}
      {files.length > 1 ? (
        <p className="text-ink-muted m-0 text-sm">{t('share.oneCaption')}</p>
      ) : null}
      <ShareActions sending={sending} sendable={sendable} isHydrated={isHydrated} onStop={stop} />
      {batch && !sending ? (
        <BatchSummary batch={batch} onSendRest={() => void shareChosen()} />
      ) : null}
    </form>
  );
}
