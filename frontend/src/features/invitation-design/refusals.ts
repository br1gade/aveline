import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';

/**
 * The words for each refusal, by action and status. There is no permissions endpoint (FR-6), so
 * every action is offered to every role and a 403 is explained after the fact: designing needs
 * `invitation:design`, which an event's owner, coordinator and designer hold, and an organization
 * member, an organization viewer and an event viewer do not. Each status here has one meaning for
 * its action, so nothing is told apart by the backend's text (FR-28).
 */
export type DesignAction =
  | 'show'
  | 'move'
  | 'add'
  | 'section'
  | 'theme'
  | 'template'
  | 'rsvpFields'
  | 'createQuestion'
  | 'editQuestion'
  | 'removeQuestion'
  | 'moveQuestion'
  | 'upload'
  | 'altText'
  | 'removeMedia';

type ProblemKey =
  | 'forbidden'
  | 'check'
  | 'stale'
  | 'cannotShow'
  | 'sectionMissing'
  | 'questionMissing'
  | 'mediaMissing'
  | 'templateMissing'
  | 'missing'
  | 'answered'
  | 'orderChanged'
  | 'inUse'
  | 'tooLarge'
  | 'wrongType'
  | 'conflict'
  | 'other';

const SECTION: Partial<Record<number, ProblemKey>> = { 403: 'forbidden', 404: 'sectionMissing' };
const QUESTION: Partial<Record<number, ProblemKey>> = { 403: 'forbidden', 404: 'questionMissing' };
const MEDIA: Partial<Record<number, ProblemKey>> = { 403: 'forbidden', 404: 'mediaMissing' };

const WORDS: Readonly<Record<DesignAction, Partial<Record<number, ProblemKey>>>> = {
  // Showing a section the template cannot render is the one 400.
  show: { ...SECTION, 400: 'cannotShow' },
  // The arrangement is refused whole when the page's view of it is out of date.
  move: { ...SECTION, 400: 'stale' },
  add: { ...SECTION, 400: 'stale' },
  section: { ...SECTION, 400: 'check' },
  theme: { 400: 'check', 403: 'forbidden', 404: 'missing' },
  template: { 400: 'check', 403: 'forbidden', 404: 'templateMissing' },
  rsvpFields: { 400: 'check', 403: 'forbidden' },
  createQuestion: { 400: 'check', 403: 'forbidden' },
  editQuestion: { ...QUESTION, 400: 'check' },
  // Deleting is refused once any guest has answered (docs/API.md §6).
  removeQuestion: { ...QUESTION, 400: 'answered' },
  moveQuestion: { ...QUESTION, 400: 'orderChanged', 409: 'orderChanged' },
  upload: { 400: 'check', 403: 'forbidden', 413: 'tooLarge', 415: 'wrongType' },
  altText: { ...MEDIA, 400: 'check' },
  // Refused while a section or the listing shows it.
  removeMedia: { ...MEDIA, 409: 'inUse' },
};

/** The page is out of date behind these: it reloads under the message. */
const STALE_STATUSES: readonly number[] = [404, 409];

export function isStaleRefusal(action: DesignAction, error: unknown): boolean {
  if (!isApiError(error)) return false;
  const key = WORDS[action][error.status];
  return STALE_STATUSES.includes(error.status) || key === 'stale' || key === 'orderChanged';
}

export function useRefusedText(action: DesignAction): (status: number) => string {
  const { t } = useTranslation('design');
  return (status) =>
    t(`problems.${WORDS[action][status] ?? (status === 409 ? 'conflict' : 'other')}`);
}
