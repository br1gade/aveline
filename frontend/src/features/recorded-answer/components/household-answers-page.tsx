import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';
import { guestListPath } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import { ChangeableWith } from '@/features/permissions';
import { oneByOne, type OneByOne } from '@/lib/queue';
import {
  AppForm,
  LEAVE_UNASKED,
  SubmitButton,
  useLeaveGuard,
  WRAPPING_BUTTON,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';

import { recordAnswer } from '../api';
import type { Asking } from '../asking';
import { answerFormValues, type AnswerFormValues } from '../form-model';
import { householdRecords, type MemberEdit, type MemberRecord } from '../household';
import type { HouseholdAnswersData, HouseholdToAnswer } from '../load';
import { refusalOf, type AnswerRefusal } from '../refusals';
import { answerFormSchema } from '../schemas';
import type { AnsweringGuest } from '../types';
import { AttendanceFields } from './attendance-fields';
import { QuestionFields } from './question-fields';
import { AnswerProblem } from './record-answer-page';

/** What the page asks of each member's form when it saves. */
interface MemberForm {
  edit: () => MemberEdit;
  /** Runs the member's checks; false puts their errors on their fields. */
  check: () => Promise<boolean>;
  /** What was sent becomes what the form started from, so it no longer counts as unsaved. */
  saved: () => void;
  refuseQuestion: (questionId: string) => void;
}

type MemberForms = Map<string, MemberForm>;

/** One member's answers, as recording one guest has them, in a fieldset under their name. */
function MemberFields({
  guest,
  asking,
  forms,
}: {
  guest: AnsweringGuest;
  asking: Asking;
  forms: MemberForms;
}) {
  const [initial, setInitial] = useState(() => answerFormValues(guest, asking));
  const form = useForm<AnswerFormValues>({
    resolver: zodResolver(answerFormSchema(guest.mode, asking)),
    defaultValues: initial,
  });
  useLeaveGuard(form);
  useEffect(() => {
    forms.set(guest.id, {
      edit: () => ({ guest, initial, values: form.getValues() }),
      check: () => form.trigger(),
      saved: () => {
        const values = form.getValues();
        setInitial(values);
        form.reset(values);
      },
      refuseQuestion: (questionId) =>
        form.setError(`answers.${questionId}`, { message: 'refused' }),
    });
    return () => {
      forms.delete(guest.id);
    };
  }, [forms, guest, initial, form]);
  return (
    <fieldset className="border-border m-0 flex min-w-0 flex-col gap-5 border p-4">
      <legend className="px-1 text-lg font-medium break-words">{guest.name}</legend>
      <AttendanceFields form={form} guest={guest} />
      <QuestionFields asking={asking} form={form} />
    </fieldset>
  );
}

function NotifyAll({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const { t } = useTranslation('recorded-answer');
  const id = useId();
  return (
    <div className="flex min-h-11 items-start gap-3">
      <Checkbox
        id={id}
        className="mt-1"
        checked={checked}
        onCheckedChange={(next) => onChange(next === true)}
        aria-describedby={`${id}-help`}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id} className="leading-snug font-normal">
          {t('household.notify')}
        </Label>
        <span id={`${id}-help`} className="text-muted-foreground text-sm">
          {t('notify.help')}
        </span>
      </div>
    </div>
  );
}

/** Who was recorded and who wasn't, when a refusal stopped the household partway. */
interface Partly {
  recorded: string[];
  notRecorded: string[];
}

/** Each member's checks, in order; the first who fails stops it, with their errors shown. */
async function checkedRecords(
  members: readonly AnsweringGuest[],
  forms: MemberForms,
  asking: Asking,
  shouldNotify: boolean,
): Promise<MemberRecord[] | null> {
  const records = householdRecords(
    asking,
    members.flatMap((guest) => forms.get(guest.id)?.edit() ?? []),
    shouldNotify,
  );
  for (const { guest } of records) {
    if (!(await forms.get(guest.id)?.check())) return null;
  }
  return records;
}

interface SaveState {
  refusal: AnswerRefusal | null;
  partly: Partly | null;
  isNothing: boolean;
}

/**
 * Records each member who changed, one request at a time (FR-118), stopping at the first refusal.
 * Everyone recorded goes to the guest list, which says so; a refusal partway says who was.
 */
function useSaveHousehold(data: HouseholdAnswersData, household: HouseholdToAnswer) {
  const { t } = useTranslation('recorded-answer');
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [forms] = useState<MemberForms>(() => new Map());
  const [state, setState] = useState<SaveState>({ refusal: null, partly: null, isNothing: false });
  /** Says who was recorded and who wasn't, marking a refused question on the member it stopped at. */
  const refused = (outcome: OneByOne<MemberRecord>) => {
    const refusal = refusalOf(outcome.error);
    const [stopped] = outcome.notDone;
    if (refusal.kind === 'questionRefused' && refusal.questionId && stopped) {
      forms.get(stopped.guest.id)?.refuseQuestion(refusal.questionId);
    }
    const names = (list: MemberRecord[]) => list.map(({ guest }) => guest.name);
    setState({
      refusal,
      partly: { recorded: names(outcome.done), notRecorded: names(outcome.notDone) },
      isNothing: false,
    });
    if (refusal.isStale) void revalidate();
  };
  const save = async (shouldNotify: boolean) => {
    const records = await checkedRecords(household.members, forms, data.asking, shouldNotify);
    if (!records) return;
    setState({ refusal: null, partly: null, isNothing: records.length === 0 });
    if (records.length === 0) return;
    const outcome = await oneByOne(records, ({ guest, body }) =>
      recordAnswer(browserSession().api, data.event.id, guest.id, body),
    );
    for (const { guest } of outcome.done) forms.get(guest.id)?.saved();
    if (outcome.error) return refused(outcome);
    // Every form is saved, so the guest list is no place to ask about leaving.
    await navigate(guestListPath(data.event.id), {
      state: { ...LEAVE_UNASKED, status: t('household.recorded', { name: household.name }) },
    });
  };
  return { forms, state, save };
}

function SaveOutcome({ state }: { state: SaveState }) {
  const { t } = useTranslation('recorded-answer');
  return (
    <>
      {state.refusal ? <AnswerProblem refusal={state.refusal} /> : null}
      {state.partly && state.partly.recorded.length > 0 ? (
        <p className="m-0" role="status">
          {t('household.partly', {
            recorded: state.partly.recorded.join(', '),
            notRecorded: state.partly.notRecorded.join(', '),
          })}
        </p>
      ) : null}
      {state.isNothing ? (
        <p className="m-0" role="status">
          {t('household.nothing')}
        </p>
      ) : null}
    </>
  );
}

function HouseholdForm({
  data,
  household,
}: {
  data: HouseholdAnswersData;
  household: HouseholdToAnswer;
}) {
  const { t } = useTranslation('recorded-answer');
  const [shouldNotify, setShouldNotify] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { forms, state, save } = useSaveHousehold(data, household);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    await save(shouldNotify).finally(() => setIsSaving(false));
  };
  return (
    <AppForm onSubmit={(event) => void submit(event)} className="max-w-[34rem] gap-5">
      <SaveOutcome state={state} />
      {data.isAskingKnown ? null : <p className="m-0">{t('askingUnknown')}</p>}
      {household.members.map((guest) =>
        guest.isErased ? (
          <p key={guest.id} className="m-0">
            {t('household.erased', { name: guest.name })}
          </p>
        ) : (
          <MemberFields
            key={`${guest.id}-${guest.mode}-${guest.revision}`}
            guest={guest}
            asking={data.asking}
            forms={forms}
          />
        ),
      )}
      <NotifyAll checked={shouldNotify} onChange={setShouldNotify} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton isSubmitting={isSaving} className={`w-auto ${WRAPPING_BUTTON}`}>
          {isSaving ? t('saving') : t('household.save')}
        </SubmitButton>
        <Button asChild variant="ghost" className={WRAPPING_BUTTON}>
          <Link to={guestListPath(data.event.id)}>{t('cancel')}</Link>
        </Button>
      </div>
    </AppForm>
  );
}

/** The form, or why there is none: the role can't read guests, or the household has gone. */
function HouseholdBody({ data }: { data: HouseholdAnswersData }) {
  const { t } = useTranslation('recorded-answer');
  const { household } = data;
  if (household.kind !== 'ready') {
    return <LoadedProblem loaded={household} refusedText={t('guestRefused')} />;
  }
  if (!household.value) return <p className="m-0">{t('household.gone')}</p>;
  return <HouseholdForm data={data} household={household.value} />;
}

/**
 * Recording answers for a whole household on one page (docs/API.md §6; design PD-147): each
 * member as recording one guest has them, saved together. Only members who changed are sent, so
 * one nobody has heard from is left as they were.
 */
export function HouseholdAnswersPage({ data }: { data: HouseholdAnswersData }) {
  const { t } = useTranslation('recorded-answer');
  const { event, household } = data;
  const name = household.kind === 'ready' && household.value ? household.value.name : event.title;
  return (
    <section className="flex flex-col gap-5">
      <Link
        to={guestListPath(event.id)}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {t('household.title')}
        </h1>
        <p className="text-muted-foreground m-0 break-words">{name}</p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('household.lead')}</p>
      <ChangeableWith to="guest:write" readOnly={t('refused.forbidden')}>
        <HouseholdBody data={data} />
      </ChangeableWith>
    </section>
  );
}
