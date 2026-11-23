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
const VENUE_RESPONSE_COPY = {
  hy: '{{guestName}}, Ձեր մասնակցության պատասխանները պահպանվել են։ Դիտեք կամ փոխեք դրանք Ձեր հրավերում։\n\n{{link}}',
  en: '{{guestName}}, your venue attendance answers have been saved. Review or change them on your invitation.\n\n{{link}}',
  ru: '{{guestName}}, ваши ответы об участии на площадках сохранены. Проверьте или измените их в приглашении.\n\n{{link}}',
  fr: '{{guestName}}, vos réponses de participation aux différents lieux ont été enregistrées. Consultez-les ou modifiez-les dans votre invitation.\n\n{{link}}',
};

export const MESSAGE_COPY = [
  {
    key: 'subscription.paid', channel: MessageChannel.EMAIL,
    subject: { en: 'Payment received — {{number}}', hy: 'Վճարումը ստացվել է — {{number}}', ru: 'Оплата получена — {{number}}' },
    body: {
      en: 'Aveline received {{amount}} on {{paidAt}} for {{description}}. Reference: {{number}}.\n\nThis is a payment confirmation, not a tax invoice. Sign in to see the current billing status:\n{{link}}',
      hy: 'Aveline-ը {{paidAt}}-ին ստացել է {{amount}}՝ {{description}}-ի համար։ Հղման համարը՝ {{number}}։\n\nՍա վճարման հաստատում է, ոչ թե հարկային հաշիվ։ Ընթացիկ վճարային կարգավիճակը տեսնելու համար մուտք գործեք՝\n{{link}}',
      ru: 'Aveline получила {{amount}} {{paidAt}} за {{description}}. Номер: {{number}}.\n\nЭто подтверждение оплаты, а не налоговый счёт. Войдите, чтобы посмотреть актуальный статус оплаты:\n{{link}}',
    },
  },
  ...[MessageChannel.EMAIL, MessageChannel.TELEGRAM, MessageChannel.WHATSAPP].map((channel) => ({
    key: 'rsvp.confirmation.venues', channel,
    subject: { hy: 'Պատասխանը պահպանվել է', en: 'Your answers are saved', ru: 'Ваши ответы сохранены', fr: 'Vos réponses sont enregistrées' },
    body: VENUE_RESPONSE_COPY,
  })),
  {
    key: 'invitation.send',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հրավեր {{hosts}}-ից', en: 'An invitation from {{hosts}}', ru: 'Приглашение от {{hosts}}' },
    body: {
      hy: 'Հարգելի {{guestName}}, սիրով հրավիրում ենք Ձեզ {{eventTitle}}։\n\nԵրբ՝ {{eventDate}}{{#place}}\nՈրտեղ՝ {{place}}{{/place}}\n\nՁեր հրավերը՝ բոլոր մանրամասներով և պատասխանելու հնարավորությամբ․\n{{link}}\n\nԱյս նամակը ստանում եք, որովհետև {{hosts}}-ը Ձեզ ավելացրել է հյուրերի ցանկում։{{#telegramLink}}\n\nՆախընտրում եք Telegram։ Սեղմեք այստեղ, և հիշեցումներն ու նորությունները կստանաք այնտեղ՝ {{telegramLink}}{{/telegramLink}}',
      en: 'Dear {{guestName}}, you are warmly invited to {{eventTitle}}.\n\nWhen: {{eventDate}}{{#place}}\nWhere: {{place}}{{/place}}\n\nYour invitation, with every detail and the place to reply:\n{{link}}\n\nYou are receiving this because {{hosts}} added you to their guest list.{{#telegramLink}}\n\nPrefer Telegram? Tap here and we will send reminders and updates there instead: {{telegramLink}}{{/telegramLink}}',
      ru: 'Здравствуйте, {{guestName}}! Сердечно приглашаем вас на «{{eventTitle}}».\n\nКогда: {{eventDate}}{{#place}}\nГде: {{place}}{{/place}}\n\nВаше приглашение со всеми подробностями и формой ответа:\n{{link}}\n\nВы получили это письмо, потому что {{hosts}} добавили вас в список гостей.{{#telegramLink}}\n\nУдобнее в Telegram? Нажмите здесь, и напоминания и новости будут приходить туда: {{telegramLink}}{{/telegramLink}}',
    },
  },
  {
    key: 'rsvp.reminder',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հիշեցում՝ {{eventTitle}}', en: 'A gentle reminder: {{eventTitle}}', ru: 'Напоминание: {{eventTitle}}' },
    body: {
      hy: '{{guestName}}, դեռ սպասում ենք Ձեր պատասխանին։\n\n{{link}}',
      en: '{{guestName}}, we are still hoping to hear from you.\n\n{{link}}',
      ru: '{{guestName}}, мы всё ещё ждём вашего ответа.\n\n{{link}}',
    },
  },
  {
    // Sent only when the host chooses to, after moving the date or a venue.
    key: 'event.details-changed',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Փոփոխություն՝ {{eventTitle}}', en: 'An update to {{eventTitle}}', ru: 'Изменения: {{eventTitle}}' },
    body: {
      hy: '{{guestName}}, {{hosts}}-ի միջոցառման մանրամասները փոխվել են։ {{note}}\n\nԹարմ տեղեկությունը՝ Ձեր հրավերում․\n{{link}}',
      en: '{{guestName}}, the details of {{hosts}}’s event have changed. {{note}}\n\nThe latest is always on your invitation:\n{{link}}',
      ru: '{{guestName}}, изменились подробности «{{eventTitle}}». {{note}}\n\nАктуальная информация всегда в вашем приглашении:\n{{link}}',
    },
  },
  {
    key: 'thankyou.send',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Շնորհակալություն', en: 'Thank you', ru: 'Спасибо' },
    body: {
      hy: '{{guestName}}, շնորհակալություն, որ մեզ հետ էիք։\n\n{{link}}',
      en: '{{guestName}}, thank you for being with us.\n\n{{link}}',
      ru: '{{guestName}}, спасибо, что были с нами.\n\n{{link}}',
    },
  },
  {
    key: 'account.password-reset',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Գաղտնաբառի վերականգնում', en: 'Reset your password', ru: 'Сброс пароля' },
    body: {
      hy: '{{name}}, սեղմեք հղումը գաղտնաբառը փոխելու համար։ Հղումը գործում է մեկ ժամ։\n\n{{link}}\n\nԵթե Դուք չեք խնդրել, անտեսեք այս նամակը։',
      en: '{{name}}, use this link to set a new password. It is valid for one hour.\n\n{{link}}\n\nIf you did not ask for this, ignore this email.',
      ru: '{{name}}, перейдите по ссылке, чтобы задать новый пароль. Ссылка действует один час.\n\n{{link}}\n\nЕсли вы не запрашивали сброс, просто проигнорируйте это письмо.',
    },
  },
  {
    // Someone tried to register with an address that already has an account.
    // Usually the owner, who forgot; the request itself is not acknowledged
    // any differently, so this email is how they find out.
    key: 'account.already-registered',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Դուք արդեն ունեք Aveline հաշիվ', en: 'You already have an Aveline account', ru: 'У вас уже есть аккаунт Aveline' },
    body: {
      hy: '{{name}}, ինչ-որ մեկը փորձեց գրանցվել այս հասցեով, բայց Դուք արդեն ունեք հաշիվ։ Մուտք գործեք՝\n\n{{link}}\n\nՄոռացե՞լ եք գաղտնաբառը՝ {{resetLink}}\n\nԵթե Դուք չէիք, անտեսեք այս նամակը։ Ձեր հաշիվը չի փոխվել։',
      en: '{{name}}, someone tried to register with this address, but you already have an account. Sign in here:\n\n{{link}}\n\nForgot your password? {{resetLink}}\n\nIf this was not you, ignore this email — nothing about your account has changed.',
      ru: '{{name}}, кто-то попытался зарегистрироваться с этим адресом, но у вас уже есть аккаунт. Войдите здесь:\n\n{{link}}\n\nЗабыли пароль? {{resetLink}}\n\nЕсли это были не вы, проигнорируйте это письмо — с вашим аккаунтом ничего не изменилось.',
    },
  },
  {
    key: 'account.verify-email',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հաստատեք Ձեր էլ. հասցեն', en: 'Confirm your email address', ru: 'Подтвердите адрес электронной почты' },
    body: {
      hy: '{{name}}, հաստատեք Ձեր էլ. հասցեն՝\n\n{{link}}',
      en: '{{name}}, please confirm your email address:\n\n{{link}}',
      ru: '{{name}}, подтвердите, пожалуйста, ваш адрес электронной почты:\n\n{{link}}',
    },
  },
  {
    key: 'event.invite',
    channel: MessageChannel.EMAIL,
    subject: {
      hy: 'Հրավեր՝ աշխատելու «{{eventTitle}}»-ի վրա',
      en: 'You have been invited to work on {{eventTitle}}',
      ru: 'Вас пригласили работать над «{{eventTitle}}»',
    },
    body: {
      hy: 'Ձեզ հրավիրել են միանալ «{{eventTitle}}»-ի թիմին որպես {{role}}։\n\n{{link}}',
      en: 'You have been invited to join the team for {{eventTitle}} as {{role}}.\n\n{{link}}',
      ru: 'Вас пригласили в команду «{{eventTitle}}» с ролью {{role}}.\n\n{{link}}',
    },
  },
  {
    key: 'organization.invite',
    channel: MessageChannel.EMAIL,
    subject: {
      hy: '{{organizationName}}-ը հրավիրում է Ձեզ',
      en: 'You have been invited to {{organizationName}}',
      ru: 'Приглашение в {{organizationName}}',
    },
    body: {
      hy: 'Ձեզ հրավիրել են միանալ {{organizationName}}-ին որպես {{role}}։\n\n{{link}}',
      en: 'You have been invited to join {{organizationName}} as {{role}}.\n\n{{link}}',
      ru: 'Вас пригласили в {{organizationName}} с ролью {{role}}.\n\n{{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.attending',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Սպասում ենք Ձեզ', en: 'We look forward to seeing you', ru: 'Ждём вас' },
    body: {
      hy: '{{guestName}}, շնորհակալություն պատասխանի համար։ Սպասում ենք Ձեզ {{eventTitle}}-ին։\n\nՊատասխանը փոխելու համար՝ {{link}}',
      en: '{{guestName}}, thank you for your reply. We look forward to seeing you at {{eventTitle}}.\n\nTo change your answer: {{link}}',
      ru: '{{guestName}}, спасибо за ответ. Будем рады видеть вас на «{{eventTitle}}».\n\nЧтобы изменить ответ: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.declined',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ստացանք Ձեր պատասխանը', en: 'We received your reply', ru: 'Мы получили ваш ответ' },
    body: {
      hy: '{{guestName}}, շնորհակալություն տեղեկացնելու համար։ Կկարոտենք Ձեզ։\n\nԵթե պլանները փոխվեն՝ {{link}}',
      en: '{{guestName}}, thank you for letting us know. You will be missed.\n\nIf your plans change: {{link}}',
      ru: '{{guestName}}, спасибо, что сообщили. Нам будет вас не хватать.\n\nЕсли планы изменятся: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.undecided',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ստացանք Ձեր պատասխանը', en: 'We received your reply', ru: 'Мы получили ваш ответ' },
    body: {
      hy: '{{guestName}}, շնորհակալություն։ Երբ որոշեք, խնդրում ենք թարմացնել պատասխանը՝\n\n{{link}}',
      en: '{{guestName}}, thank you. When you know, please update your answer:\n\n{{link}}',
      ru: '{{guestName}}, спасибо. Когда решите, пожалуйста, обновите ответ:\n\n{{link}}',
    },
  },
  {
    key: 'ticket.cancelled',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ձեր պատվերը չեղարկվել է', en: 'Your order has been cancelled', ru: 'Ваш заказ отменён' },
    body: {
      hy: '{{buyerName}}, Ձեր տոմսերը {{eventTitle}}-ին չեղարկվել են, և {{amount}} վերադարձվել է։ Տոմսերն այլևս վավեր չեն։',
      en: '{{buyerName}}, your tickets for {{eventTitle}} have been cancelled and {{amount}} refunded. The tickets are no longer valid.',
      ru: '{{buyerName}}, ваши билеты на «{{eventTitle}}» отменены, сумма {{amount}} возвращена. Билеты больше не действительны.',
    },
  },
  {
    key: 'ticket.acknowledgement',
    channel: MessageChannel.EMAIL,
    subject: {"en": "Please acknowledge the event rules", "ru": "Пожалуйста, подтвердите ознакомление с правилами мероприятия", "fr": "Veuillez prendre connaissance des règles de l’événement", "hy": "Խնդրում ենք հաստատել միջոցառման կանոններին ծանոթանալը"},
    body: {"en": "{{guestName}}, your ticket for {{eventTitle}} is ready. Before check-in, please read and acknowledge the required statements through your personal invitation:\n\n{{link}}\n\nKeep this link private.", "ru": "{{guestName}}, ваш билет на {{eventTitle}} готов. До регистрации на входе ознакомьтесь с обязательными условиями и подтвердите согласие в личном приглашении:\n\n{{link}}\n\nНе передавайте эту ссылку другим.", "fr": "{{guestName}}, votre billet pour {{eventTitle}} est prêt. Avant votre admission, veuillez lire et accepter les conditions requises dans votre invitation personnelle :\n\n{{link}}\n\nGardez ce lien confidentiel.", "hy": "{{guestName}}, Ձեր {{eventTitle}} միջոցառման տոմսը պատրաստ է։ Մուտքի գրանցումից առաջ խնդրում ենք կարդալ և հաստատել պարտադիր պայմանները Ձեր անձնական հրավերում՝\n\n{{link}}\n\nԱյս հղումը պահեք գաղտնի։"},
  },
  {
    key: 'ticket.issued',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ձեր տոմսերը՝ {{eventTitle}}', en: 'Your tickets for {{eventTitle}}', ru: 'Ваши билеты на «{{eventTitle}}»' },
    body: {
      hy: 'Շնորհակալություն, {{buyerName}}։ Ձեր տոմսերը {{eventTitle}}-ին պատրաստ են։\n\nԵրբ՝ {{eventDate}}{{#place}}\nՈրտեղ՝ {{place}}{{/place}}\nՏոմսեր՝ {{ticketCount}}, ընդամենը՝ {{amount}}\n\n{{link}}\n\nԱյս հղումը պահեք գաղտնի․ այն բացում է Ձեր տոմսերը։',
      en: 'Thank you, {{buyerName}}. Your tickets for {{eventTitle}} are ready.\n\nWhen: {{eventDate}}{{#place}}\nWhere: {{place}}{{/place}}\nTickets: {{ticketCount}}, total {{amount}}\n\n{{link}}\n\nKeep this link private: anyone who has it can open your tickets.',
      ru: 'Спасибо, {{buyerName}}! Ваши билеты на «{{eventTitle}}» готовы.\n\nКогда: {{eventDate}}{{#place}}\nГде: {{place}}{{/place}}\nБилетов: {{ticketCount}}, сумма {{amount}}\n\n{{link}}\n\nНе передавайте эту ссылку другим: по ней открываются ваши билеты.',
    },
  },
  // ── SMS ────────────────────────────────────────────────────────────
  // The guest messages again, for a guest reached by text: no subject, and on
  // one line, because a text is read in a few seconds and paid for by length.
  {
    key: 'invitation.send',
    channel: MessageChannel.SMS,
    body: {
      hy: 'Հարգելի {{guestName}}, սիրով հրավիրում ենք Ձեզ {{eventTitle}}։ {{link}}',
      en: 'Dear {{guestName}}, you are warmly invited to {{eventTitle}}. {{link}}',
      ru: 'Здравствуйте, {{guestName}}! Приглашаем вас на «{{eventTitle}}». {{link}}',
    },
  },
  {
    key: 'rsvp.reminder',
    channel: MessageChannel.SMS,
    body: {
      hy: '{{guestName}}, դեռ սպասում ենք Ձեր պատասխանին։ {{link}}',
      en: '{{guestName}}, we are still hoping to hear from you. {{link}}',
      ru: '{{guestName}}, мы всё ещё ждём вашего ответа. {{link}}',
    },
  },
  {
    key: 'event.details-changed',
    channel: MessageChannel.SMS,
    body: {
      hy: '{{guestName}}, {{hosts}}-ի միջոցառման մանրամասները փոխվել են։ {{note}} Թարմ տեղեկությունը՝ Ձեր հրավերում․ {{link}}',
      en: '{{guestName}}, the details of {{hosts}}’s event have changed. {{note}} The latest is always on your invitation: {{link}}',
      ru: '{{guestName}}, изменились подробности «{{eventTitle}}». {{note}} Актуально в приглашении: {{link}}',
    },
  },
  {
    key: 'thankyou.send',
    channel: MessageChannel.SMS,
    body: {
      hy: '{{guestName}}, շնորհակալություն, որ մեզ հետ էիք։ {{link}}',
      en: '{{guestName}}, thank you for being with us. {{link}}',
      ru: '{{guestName}}, спасибо, что были с нами. {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.attending',
    channel: MessageChannel.SMS,
    body: {
      hy: '{{guestName}}, շնորհակալություն պատասխանի համար։ Սպասում ենք Ձեզ {{eventTitle}}-ին։ Պատասխանը փոխելու համար՝ {{link}}',
      en: '{{guestName}}, thank you for your reply. We look forward to seeing you at {{eventTitle}}. To change your answer: {{link}}',
      ru: '{{guestName}}, спасибо за ответ. Ждём вас на «{{eventTitle}}». Изменить ответ: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.declined',
    channel: MessageChannel.SMS,
    body: {
      hy: '{{guestName}}, շնորհակալություն տեղեկացնելու համար։ Կկարոտենք Ձեզ։ Եթե պլանները փոխվեն՝ {{link}}',
      en: '{{guestName}}, thank you for letting us know. You will be missed. If your plans change: {{link}}',
      ru: '{{guestName}}, спасибо, что сообщили. Будем скучать. Если планы изменятся: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.undecided',
    channel: MessageChannel.SMS,
    body: {
      hy: '{{guestName}}, շնորհակալություն։ Երբ որոշեք, խնդրում ենք թարմացնել պատասխանը՝ {{link}}',
      en: '{{guestName}}, thank you. When you know, please update your answer: {{link}}',
      ru: '{{guestName}}, спасибо. Когда решите, обновите ответ: {{link}}',
    },
  },

  // Telegram (decided 10 October 2026, D13): the guest-facing messages, for
  // guests who opened the bot from their invitation. Plain text, as the
  // transport sends it, and warmer than SMS because it costs nothing per
  // character. Reviewed by the team before the pilot. WhatsApp stays off
  // until Meta approves its templates.
  {
    key: 'invitation.send',
    channel: MessageChannel.TELEGRAM,
    body: {
      hy: 'Հարգելի {{guestName}}, սիրով հրավիրում ենք Ձեզ {{eventTitle}}։\n\nՁեր հրավերը՝ {{link}}',
      en: 'Dear {{guestName}}, you are warmly invited to {{eventTitle}}.\n\nYour invitation: {{link}}',
      ru: 'Здравствуйте, {{guestName}}! Сердечно приглашаем вас на «{{eventTitle}}».\n\nВаше приглашение: {{link}}',
    },
  },
  {
    key: 'rsvp.reminder',
    channel: MessageChannel.TELEGRAM,
    body: {
      hy: '{{guestName}}, դեռ սպասում ենք Ձեր պատասխանին {{eventTitle}}-ի համար։ Պատասխանել՝ {{link}}',
      en: '{{guestName}}, we are still hoping to hear from you about {{eventTitle}}. Reply here: {{link}}',
      ru: '{{guestName}}, мы всё ещё ждём вашего ответа о «{{eventTitle}}». Ответить: {{link}}',
    },
  },
  {
    key: 'event.details-changed',
    channel: MessageChannel.TELEGRAM,
    body: {
      hy: '{{guestName}}, {{hosts}}-ի միջոցառման մանրամասները փոխվել են։ {{note}}\n\nԹարմ տեղեկությունը՝ Ձեր հրավերում․ {{link}}',
      en: '{{guestName}}, the details of {{hosts}}’s event have changed. {{note}}\n\nThe latest is always on your invitation: {{link}}',
      ru: '{{guestName}}, изменились подробности «{{eventTitle}}». {{note}}\n\nАктуальная информация в вашем приглашении: {{link}}',
    },
  },
  {
    key: 'thankyou.send',
    channel: MessageChannel.TELEGRAM,
    body: {
      hy: '{{guestName}}, շնորհակալություն, որ մեզ հետ էիք։ {{link}}',
      en: '{{guestName}}, thank you for being with us. {{link}}',
      ru: '{{guestName}}, спасибо, что были с нами. {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.attending',
    channel: MessageChannel.TELEGRAM,
    body: {
      hy: '{{guestName}}, շնորհակալություն պատասխանի համար։ Սպասում ենք Ձեզ {{eventTitle}}-ին։ Պատասխանը փոխելու համար՝ {{link}}',
      en: '{{guestName}}, thank you for your reply. We look forward to seeing you at {{eventTitle}}. To change your answer: {{link}}',
      ru: '{{guestName}}, спасибо за ответ. Ждём вас на «{{eventTitle}}». Изменить ответ: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.declined',
    channel: MessageChannel.TELEGRAM,
    body: {
      hy: '{{guestName}}, շնորհակալություն տեղեկացնելու համար։ Կկարոտենք Ձեզ։ Եթե պլանները փոխվեն՝ {{link}}',
      en: '{{guestName}}, thank you for letting us know. You will be missed. If your plans change: {{link}}',
      ru: '{{guestName}}, спасибо, что сообщили. Будем скучать. Если планы изменятся: {{link}}',
    },
  },
  {
    key: 'rsvp.confirmation.undecided',
    channel: MessageChannel.TELEGRAM,
    body: {
      hy: '{{guestName}}, շնորհակալություն։ Երբ որոշեք, խնդրում ենք թարմացնել պատասխանը՝ {{link}}',
      en: '{{guestName}}, thank you. When you know, please update your answer: {{link}}',
      ru: '{{guestName}}, спасибо. Когда решите, обновите ответ: {{link}}',
    },
  },
];
