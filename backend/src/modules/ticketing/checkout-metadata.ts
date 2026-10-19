import { Prisma } from '@prisma/client';
import { resolveTranslation } from '../../common/locale';
import { fieldsForPage } from '../rsvp/rsvp-fields';

export async function checkoutMetadata(tx: Prisma.TransactionClient, eventId: string, locale: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: {
    attendanceMode: true, attendanceRevision: true, defaultLocale: true,
    invitation: { select: { rsvpFields: true, questions: { orderBy: { sortOrder: 'asc' }, select: { id: true, type: true, required: true, prompt: true, options: true } } } },
  } });
  const translate = (content: unknown) => resolveTranslation(content, locale, event.defaultLocale);
  const fields = fieldsForPage(event.invitation?.rsvpFields, locale, event.defaultLocale);
  return { attendanceMode: event.attendanceMode, attendanceRevision: event.attendanceRevision,
    rsvpFields: { dietary: fields.dietary, drinkPreference: fields.drinkPreference },
    acknowledgementsRequiredBeforeCheckIn: (event.invitation?.questions ?? []).filter((question) => question.type === 'SIGNATURE' && question.required).map((question) => ({ questionId: question.id, prompt: translate(question.prompt) })),
    questions: (event.invitation?.questions ?? []).filter((question) => question.type !== 'SIGNATURE').map((question) => ({ id: question.id, type: question.type, required: question.required,
      prompt: translate(question.prompt), options: translate(question.options) ?? [] })),
  };
}
