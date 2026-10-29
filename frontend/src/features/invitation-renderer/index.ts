/**
 * The guest invitation renderer (setup proposal §5.8): the payload in, the page out. The reply
 * form is not part of it; a route passes it in through `renderReply`. Server-only loading is in
 * index.server.ts.
 */
export {
  BLOCK_EDITING,
  type BlockEditing,
  type BlockMediaUse,
  type ContentField,
  type ContentFieldKind,
} from './blocks/fields';
export { imageSource, type ImageSource } from './components/image-source';
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
export { BLOCK_TYPES, BUILT_IN_FIELDS } from './types';
export type {
  AttendanceView,
  BlockMedia,
  BlockType,
  BuiltInField,
  Invitation,
  InvitationBlock,
  InvitationGuest,
  QuestionType,
  RsvpFieldConfig,
  RsvpQuestion,
  RsvpStatus,
} from './types';
