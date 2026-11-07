import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { PageActions } from '@/ui/app-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/kit/alert-dialog';
import { Button } from '@/ui/kit/button';

import { removeQuestion } from '../api';
import { inDefaultLanguage } from '../languages';
import { isStaleRefusal } from '../refusals';
import type { Design, Question } from '../types';
import { DesignRefusal, type DesignRefusalState } from './design-parts';

interface RemoveProps {
  design: Design;
  question: Question;
  page: PageActions;
  onClose: () => void;
}

/**
 * Removing a question nobody has answered, after a confirmation (design PD-61). Once anyone has,
 * the backend refuses, since it would discard their answers; the page offers it only before, and
 * still words the refusal, since an agreement or a ticket checkout counts too.
 */
export function RemoveQuestionDialog({ design, question, page, onClose }: RemoveProps) {
  const { t } = useTranslation('design');
  const [isRemoving, setIsRemoving] = useState(false);
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const isDoneRef = useRef(false);
  const prompt =
    inDefaultLanguage(question.prompt, design.event.defaultLocale) ?? t('questions.noWording');

  const confirm = async () => {
    setRefusal(null);
    setIsRemoving(true);
    try {
      await removeQuestion(browserSession().api, design.slug, question.id);
      await page.done(t('questions.removed', { prompt }));
      isDoneRef.current = true;
      onClose();
    } catch (error) {
      setRefusal({ action: 'removeQuestion', problem: problemFrom(error) });
      setIsRemoving(false);
      if (isStaleRefusal('removeQuestion', error)) page.reload();
    }
  };

  return (
    <AlertDialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <AlertDialogContent
        onCloseAutoFocus={(closing) => (isDoneRef.current ? page.focusStatus(closing) : undefined)}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('removeQuestion.title', { prompt })}</AlertDialogTitle>
          <AlertDialogDescription>{t('removeQuestion.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        {refusal ? <DesignRefusal refusal={refusal} /> : null}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('removeQuestion.cancel')}</AlertDialogCancel>
          <Button variant="destructive" disabled={isRemoving} onClick={() => void confirm()}>
            {isRemoving ? t('removeQuestion.removing') : t('removeQuestion.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
