import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import { AppForm, ErrorLine, SelectField, SubmitButton, type PageActions } from '@/ui/app-form';
import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { uploadMedia, type UploadKind } from '../api';
import {
  isAudioFile,
  UPLOAD_ACCEPT,
  uploadable,
  uploadProblem,
  type UploadProblem,
} from '../media-rules';
import { DesignRefusal, type DesignRefusalState } from './design-parts';

const KINDS: readonly UploadKind[] = ['PHOTO', 'COVER', 'LOGO'];

type FileProblem = UploadProblem | 'noFile';

function useUpload(eventId: string, page: PageActions) {
  const { t } = useTranslation('design');
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const upload = async (file: File | undefined, kind: UploadKind, onDone: () => void) => {
    setRefusal(null);
    const problem = file ? uploadProblem(file) : 'noFile';
    setFileProblem(problem);
    if (!file || problem) return;
    setIsUploading(true);
    try {
      // Audio is AUDIO by its type; a kind is sent for a picture only.
      await uploadMedia(
        browserSession().api,
        eventId,
        uploadable(file),
        isAudioFile(file) ? null : kind,
      );
      onDone();
      await page.done(t('media.uploaded', { name: file.name }));
    } catch (error) {
      setRefusal({ action: 'upload', problem: problemFrom(error) });
    } finally {
      setIsUploading(false);
    }
  };
  return { fileProblem, refusal, isUploading, upload };
}

/**
 * One file at a time (docs/API.md §6, "Uploading a file"; design PD-62): the browser's own file
 * input, and for a picture its kind. A wrong type or more than 10 MB is refused before sending.
 */
export function UploadForm({ eventId, page }: { eventId: string; page: PageActions }) {
  const { t } = useTranslation('design');
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<UploadKind>('PHOTO');
  const { fileProblem, refusal, isUploading, upload } = useUpload(eventId, page);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reset = () => {
      if (fileRef.current) fileRef.current.value = '';
    };
    void upload(fileRef.current?.files?.[0], kind, reset);
  };
  return (
    <AppForm onSubmit={submit} className="max-w-[30rem] gap-4">
      {refusal ? <DesignRefusal refusal={refusal} /> : null}
      <Field data-invalid={fileProblem ? 'true' : undefined} className="gap-2">
        <FieldLabel htmlFor={id}>{t('media.file')}</FieldLabel>
        <input
          ref={fileRef}
          id={id}
          name="file"
          type="file"
          accept={UPLOAD_ACCEPT}
          aria-describedby={`${id}-help${fileProblem ? ` ${id}-error` : ''}`}
          aria-invalid={fileProblem ? true : undefined}
          className="file:border-input file:bg-background min-h-11 text-sm file:mr-3 file:min-h-11 file:border file:px-4"
        />
        <FieldDescription id={`${id}-help`}>{t('media.fileHelp')}</FieldDescription>
        {fileProblem ? (
          <ErrorLine id={`${id}-error`}>{t(`media.problems.${fileProblem}`)}</ErrorLine>
        ) : null}
      </Field>
      <SelectField
        label={t('media.kind')}
        help={t('media.kindHelp')}
        value={kind}
        onChange={(change) => setKind(change.target.value as UploadKind)}
      >
        {KINDS.map((value) => (
          <NativeSelectOption key={value} value={value}>
            {t(`media.kinds.${value}`)}
          </NativeSelectOption>
        ))}
      </SelectField>
      <SubmitButton isSubmitting={isUploading} className="w-auto self-start">
        {isUploading ? t('media.uploading') : t('media.upload')}
      </SubmitButton>
    </AppForm>
  );
}
