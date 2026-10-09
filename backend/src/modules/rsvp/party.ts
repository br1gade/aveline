import { RsvpStatus } from '@prisma/client';
import { AnswerableQuestion, answersProblem, unansweredRequired } from './answers';
import { PartyMemberDto } from './dto/submit-rsvp.dto';
import { builtInAnswerProblem } from './rsvp-fields';

/**
 * Plus-ones the guest names on the form (decided 10 October 2026, D11): each
 * answers for themselves — their own status, dietary needs and the host's
 * questions — and a required question binds an attending plus-one exactly as
 * it binds everyone else. They used to be created with the respondent's
 * status and nothing else, so the meal count was short by every plus-one.
 */
export function partyStatus(member: PartyMemberDto, respondentStatus: RsvpStatus): RsvpStatus {
  return member.status ?? respondentStatus;
}

/** Each plus-one's answers, checked as anyone's are, naming them. */
export function partyAnswersProblem(questions: AnswerableQuestion[], rsvpFields: unknown, party: PartyMemberDto[]): string | null {
  for (const member of party) {
    const problem =
      answersProblem(questions, member.answers ?? []) ?? builtInAnswerProblem(rsvpFields, { dietary: member.dietary });
    if (problem) return `party: ${member.firstName} ${problem}`;
  }
  return null;
}

/** A required question an attending new plus-one has not answered, naming them. */
export function partyRequiredProblem(
  questions: AnswerableQuestion[],
  party: PartyMemberDto[],
  respondentStatus: RsvpStatus,
): string | null {
  for (const member of party) {
    const answered = new Set((member.answers ?? []).map((answer) => answer.questionId));
    const missing = unansweredRequired(questions, answered, partyStatus(member, respondentStatus));
    if (missing) return `party: ${member.firstName} must answer ${missing.id}, as they are coming`;
  }
  return null;
}

/**
 * Whether a plus-one follows the respondent's new answer. Only one still
 * agreeing with the respondent's previous answer, or never answered: a
 * plus-one given their own answer keeps it. Following always, a plus-one
 * marked declined came back as attending on any later edit.
 */
export function isFollowing(followerStatus: RsvpStatus | undefined, respondentBefore: RsvpStatus | undefined): boolean {
  if (followerStatus === undefined || followerStatus === RsvpStatus.PENDING) return true;
  return followerStatus === respondentBefore;
}
