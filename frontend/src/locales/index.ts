import enAccount from './en/account.json';
import enApp from './en/app.json';
import enCommon from './en/common.json';
import enInvitation from './en/invitation.json';
import enReply from './en/reply.json';
import hyAccount from './hy/account.json';
import hyApp from './hy/app.json';
import hyCommon from './hy/common.json';
import hyInvitation from './hy/invitation.json';
import hyReply from './hy/reply.json';
import ruAccount from './ru/account.json';
import ruApp from './ru/app.json';
import ruCommon from './ru/common.json';
import ruInvitation from './ru/invitation.json';
import ruReply from './ru/reply.json';

/**
 * Every namespace in every language. English is the source of the keys; Armenian and Russian are
 * drafts until a native reader checks them (design PD-9).
 */
export const resources = {
  en: {
    account: enAccount,
    app: enApp,
    common: enCommon,
    invitation: enInvitation,
    reply: enReply,
  },
  hy: {
    account: hyAccount,
    app: hyApp,
    common: hyCommon,
    invitation: hyInvitation,
    reply: hyReply,
  },
  ru: {
    account: ruAccount,
    app: ruApp,
    common: ruCommon,
    invitation: ruInvitation,
    reply: ruReply,
  },
} as const;
