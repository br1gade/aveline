import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { problemFrom } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { reorderQuestions } from '../api';
import { editDesignQuestionPath, newDesignQuestionPath } from '../paths';
import { inDefaultLanguage } from '../languages';
import { moveQuestionOrder } from '../payload';
import { isStaleRefusal } from '../refusals';
import type { Design, Question } from '../types';
import { DesignRefusal, type DesignRefusalState } from './design-parts';
import { RemoveQuestionDialog } from './remove-question-dialog';

/** Moving one question sends every id in the new order with the order read; a 409 reloads. */
function useMove(design: Design, page: PageActions) {
  const { t } = useTranslation('design');
  const [refusal, setRefusal] = useState<DesignRefusalState | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const move = async (question: Question, direction: -1 | 1) => {
    const body = moveQuestionOrder(design.questions, question.id, direction);
    if (!body) return;
    setRefusal(null);
    setIsBusy(true);
    try {
      await reorderQuestions(browserSession().api, design.slug, body);
      const prompt = inDefaultLanguage(question.prompt, design.event.defaultLocale) ?? '';
      await page.done(t(direction < 0 ? 'questions.movedUp' : 'questions.movedDown', { prompt }));
    } catch (error) {
      setRefusal({ action: 'moveQuestion', problem: problemFrom(error) });
      if (isStaleRefusal('moveQuestion', error)) page.reload();
    } finally {
      setIsBusy(false);
    }
  };
  return { refusal, isBusy, move };
}

interface RowProps {
  design: Design;
  question: Question;
  position: number;
  move: ReturnType<typeof useMove>;
  onRemove: (question: Question) => void;
}

function QuestionRow({ design, question, position, move, onRemove }: RowProps) {
  const { t } = useTranslation('design');
  const prompt = inDefaultLanguage(question.prompt, design.event.defaultLocale);
  const name = prompt ?? t('questions.noWording');
  const isAnswered = question.answerCount > 0;
  const label = (action: string) => t('actionFor', { action, name });
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <h3 className="m-0 text-base font-medium break-words">{name}</h3>
      <p className="text-muted-foreground m-0 text-sm">
        {t(`questions.types.${question.type}`)} ·{' '}
        {t(question.required ? 'questions.required' : 'questions.optional')}
        {isAnswered ? ` · ${t('questions.answered', { count: question.answerCount })}` : null}
      </p>
      {isAnswered ? (
        <p className="text-muted-foreground m-0 text-sm">{t('questions.cannotRemove')}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button asChild variant="outline">
          <Link
            to={editDesignQuestionPath(design.event.id, question.id)}
            aria-label={label(t('questions.edit'))}
          >
            {t('questions.edit')}
          </Link>
        </Button>
        {isAnswered ? null : (
          <Button
            variant="ghost"
            aria-label={label(t('questions.remove'))}
            onClick={() => onRemove(question)}
          >
            {t('questions.remove')}
          </Button>
        )}
        {position > 0 ? (
          <Button
            variant="ghost"
            disabled={move.isBusy}
            aria-label={label(t('questions.moveUp'))}
            onClick={() => void move.move(question, -1)}
          >
            {t('questions.moveUp')}
          </Button>
        ) : null}
        {position < design.questions.length - 1 ? (
          <Button
            variant="ghost"
            disabled={move.isBusy}
            aria-label={label(t('questions.moveDown'))}
            onClick={() => void move.move(question, 1)}
          >
            {t('questions.moveDown')}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The host's own questions in the order guests are asked them (design PD-61): each edited on its
 * own page, removed after a question while nobody has answered it, or moved.
 */
export function QuestionList({ design, page }: { design: Design; page: PageActions }) {
  const { t } = useTranslation('design');
  const move = useMove(design, page);
  const [target, setTarget] = useState<Question | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Button asChild className="self-start">
        <Link to={newDesignQuestionPath(design.event.id)}>{t('questions.add')}</Link>
      </Button>
      {move.refusal ? <DesignRefusal refusal={move.refusal} /> : null}
      {design.questions.length === 0 ? (
        <p className="text-muted-foreground m-0">{t('questions.none')}</p>
      ) : (
        <ol className="m-0 flex max-w-[40rem] list-none flex-col gap-3 p-0">
          {design.questions.map((question, position) => (
            <QuestionRow
              key={question.id}
              design={design}
              question={question}
              position={position}
              move={move}
              onRemove={setTarget}
            />
          ))}
        </ol>
      )}
      {target ? (
        <RemoveQuestionDialog
          design={design}
          question={target}
          page={page}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </div>
  );
}
