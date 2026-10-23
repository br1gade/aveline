import enCommon from './en/common.json';
import enInvitation from './en/invitation.json';
import enReply from './en/reply.json';
import hyCommon from './hy/common.json';
import hyInvitation from './hy/invitation.json';
import hyReply from './hy/reply.json';
import ruCommon from './ru/common.json';
import ruInvitation from './ru/invitation.json';
import ruReply from './ru/reply.json';

/**
 * Every namespace in every language. English is the source of the keys; Armenian and Russian are
 * drafts until a native reader checks them (design PD-9).
 */
export const resources = {
  en: { common: enCommon, invitation: enInvitation, reply: enReply },
  hy: { common: hyCommon, invitation: hyInvitation, reply: hyReply },
  ru: { common: ruCommon, invitation: ruInvitation, reply: ruReply },
} as const;
