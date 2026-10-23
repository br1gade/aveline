/**
 * The guest's reply (spec §6): the form, its states and what it sends. The invitation renderer
 * places it in the reply section through `renderReply`; it never imports this feature.
 */
export type { ReplyLink } from './api';
export { GuestReply, type GuestReplyProps } from './components/guest-reply';
export { replySummaryFrom } from './summary';
export type { ReplyRecord } from './types';
