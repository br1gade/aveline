/**
 * The guest invitation renderer (setup proposal §5.8): the payload in, the page out. The reply
 * form is not part of it; a route passes it in through `renderReply`. Server-only loading is in
 * index.server.ts.
 */
export { InvitationNotFound } from './components/invitation-not-found';
export {
  REPLY_HEADING_ID,
  replyFromInvitation,
  type ReplySummary,
} from './components/reply-summary';
export { InvitationPage, type InvitationPageProps } from './invitation-page';
export {
  invitationLanguage,
  invitationMeta,
  type InvitationPageData,
  type PreviewMeta,
} from './page-data';
export { invitationPalette } from './theme';
export type {
  Invitation,
  InvitationBlock,
  InvitationGuest,
  QuestionType,
  RsvpQuestion,
  RsvpStatus,
} from './types';
