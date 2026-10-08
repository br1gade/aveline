import { MessageChannel } from '@prisma/client';

/**
 * Aveline's own message copy, which every organization falls back to.
 *
 * Its own module so it can be read without running a seed: the seed scripts
 * execute on import, and the test that checks every template key the code
 * sends has copy here needs the data, not the side effects. Both the
 * production seed and the development seed read this one list — there used to
 * be a second, shorter copy in the development seed that had already drifted.
 */
export const MESSAGE_COPY = [
  {
    key: 'invitation.send',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հրավեր {{hosts}}-ից', en: 'An invitation from {{hosts}}' },
    body: {
      hy: 'Հարգելի {{guestName}}, սիրով հրավիրում ենք Ձեզ {{eventTitle}}։\n\n{{link}}',
      en: 'Dear {{guestName}}, you are warmly invited to {{eventTitle}}.\n\n{{link}}',
    },
  },
  {
    key: 'rsvp.reminder',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հիշեցում՝ {{eventTitle}}', en: 'A gentle reminder: {{eventTitle}}' },
    body: {
      hy: '{{guestName}}, դեռ սպասում ենք Ձեր պատասխանին։\n\n{{link}}',
      en: '{{guestName}}, we are still hoping to hear from you.\n\n{{link}}',
    },
  },
  {
    // Sent only when the host chooses to, after moving the date or a venue.
    key: 'event.details-changed',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Փոփոխություն՝ {{eventTitle}}', en: 'An update to {{eventTitle}}' },
    body: {
      hy: '{{guestName}}, {{hosts}}-ի միջոցառման մանրամասները փոխվել են։ {{note}}\n\nԹարմ տեղեկությունը՝ Ձեր հրավերում․\n{{link}}',
      en: '{{guestName}}, the details of {{hosts}}’s event have changed. {{note}}\n\nThe latest is always on your invitation:\n{{link}}',
    },
  },
  {
    key: 'thankyou.send',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Շնորհակալություն', en: 'Thank you' },
    body: {
      hy: '{{guestName}}, շնորհակալություն, որ մեզ հետ էիք։\n\n{{link}}',
      en: '{{guestName}}, thank you for being with us.\n\n{{link}}',
    },
  },
  {
    key: 'account.password-reset',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Գաղտնաբառի վերականգնում', en: 'Reset your password' },
    body: {
      hy: '{{name}}, սեղմեք հղումը գաղտնաբառը փոխելու համար։ Հղումը գործում է մեկ ժամ։\n\n{{link}}\n\nԵթե Դուք չեք խնդրել, անտեսեք այս նամակը։',
      en: '{{name}}, use this link to set a new password. It is valid for one hour.\n\n{{link}}\n\nIf you did not ask for this, ignore this email.',
    },
  },
  {
    key: 'account.verify-email',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հաստատեք Ձեր էլ. հասցեն', en: 'Confirm your email address' },
    body: {
      hy: '{{name}}, հաստատեք Ձեր էլ. հասցեն՝\n\n{{link}}',
      en: '{{name}}, please confirm your email address:\n\n{{link}}',
    },
  },
  {
    key: 'event.invite',
    channel: MessageChannel.EMAIL,
    subject: {
      hy: 'Հրավեր՝ աշխատելու «{{eventTitle}}»-ի վրա',
      en: 'You have been invited to work on {{eventTitle}}',
    },
    body: {
      hy: 'Ձեզ հրավիրել են միանալ «{{eventTitle}}»-ի թիմին որպես {{role}}։\n\n{{link}}',
      en: 'You have been invited to join the team for {{eventTitle}} as {{role}}.\n\n{{link}}',
    },
  },
  {
    key: 'organization.invite',
    channel: MessageChannel.EMAIL,
    subject: {
      hy: '{{organizationName}}-ը հրավիրում է Ձեզ',
      en: 'You have been invited to {{organizationName}}',
    },
    body: {
      hy: 'Ձեզ հրավիրել են միանալ {{organizationName}}-ին որպես {{role}}։\n\n{{link}}',
      en: 'You have been invited to join {{organizationName}} as {{role}}.\n\n{{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.attending',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Սպասում ենք Ձեզ', en: 'We look forward to seeing you' },
    body: {
      hy: '{{guestName}}, շնորհակալություն պատասխանի համար։ Սպասում ենք Ձեզ {{eventTitle}}-ին։\n\nՊատասխանը փոխելու համար՝ {{link}}',
      en: '{{guestName}}, thank you for your reply. We look forward to seeing you at {{eventTitle}}.\n\nTo change your answer: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.declined',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ստացանք Ձեր պատասխանը', en: 'We received your reply' },
    body: {
      hy: '{{guestName}}, շնորհակալություն տեղեկացնելու համար։ Կկարոտենք Ձեզ։\n\nԵթե պլանները փոխվեն՝ {{link}}',
      en: '{{guestName}}, thank you for letting us know. You will be missed.\n\nIf your plans change: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.undecided',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ստացանք Ձեր պատասխանը', en: 'We received your reply' },
    body: {
      hy: '{{guestName}}, շնորհակալություն։ Երբ որոշեք, խնդրում ենք թարմացնել պատասխանը՝\n\n{{link}}',
      en: '{{guestName}}, thank you. When you know, please update your answer:\n\n{{link}}',
    },
  },
  {
    key: 'ticket.cancelled',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ձեր պատվերը չեղարկվել է', en: 'Your order has been cancelled' },
    body: {
      hy: '{{buyerName}}, Ձեր տոմսերը {{eventTitle}}-ին չեղարկվել են, և {{amount}} վերադարձվել է։ Տոմսերն այլևս վավեր չեն։',
      en: '{{buyerName}}, your tickets for {{eventTitle}} have been cancelled and {{amount}} refunded. The tickets are no longer valid.',
    },
  },
  {
    key: 'ticket.issued',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ձեր տոմսերը', en: 'Your tickets' },
    body: {
      hy: 'Շնորհակալություն, {{buyerName}}։ Ձեր տոմսերը՝\n\n{{link}}',
      en: 'Thank you, {{buyerName}}. Your tickets:\n\n{{link}}',
    },
  },
];
