import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RsvpStatus } from '@prisma/client';
import { negotiateLocale, resolveTranslation } from '../../common/locale';
import { PrismaService } from '../../prisma/prisma.service';
import { formatAnswer, optionLabels, tallyAnswers } from '../rsvp/answer-display';
import { LEGACY_REPORT_QUESTION_LIMIT, LEGACY_REPORT_ROW_LIMIT } from './dto/report-query.dto';

/**
 * What guests answered to the host's own questions — "meat or fish?", "do you
 * need the shuttle?" — per question, counted and listed.
 *
 * Answers used to be stored and shown only to the guest who gave them: a
 * question nobody could read the answers to, which the spec's own rule says
 * should never have been asked.
 *
 * Counted from the rows it lists rather than by a second query: every answer
 * is returned anyway, so counting them in Postgres would read them twice.
 */
@Injectable()
export class AnswersSheetService {
  constructor(private readonly prisma: PrismaService) {}

  async answersSheet(eventId: string, requestedLocale?: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        locales: true,
        defaultLocale: true,
        invitation: {
          select: {
            questions: {
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              take: LEGACY_REPORT_QUESTION_LIMIT + 1,
              select: { id: true, type: true, required: true, prompt: true, options: true },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException(`No event ${eventId}`);
    if ((event.invitation?.questions.length ?? 0) > LEGACY_REPORT_QUESTION_LIMIT) {
      throw new BadRequestException('Report exceeds 100 questions; use the paged answers at answers/questions');
    }

    const locale = negotiateLocale(requestedLocale, event.locales, event.defaultLocale);
    const responsesByQuestion = await this.responsesByQuestion(eventId);

    return {
      locale,
      questions: (event.invitation?.questions ?? []).map((question) => {
        const labels = optionLabels(question.options, locale, event.defaultLocale);
        const responses = responsesByQuestion.get(question.id) ?? [];
        return {
          id: question.id,
          type: question.type,
          required: question.required,
          prompt: resolveTranslation<string>(question.prompt, locale, event.defaultLocale),
          options: labels,
          answered: responses.length,
          tally: tallyAnswers(question, responses, labels, locale),
          responses: responses.map((response) => ({
            ...response,
            display: formatAnswer(question, response.value, labels, locale),
          })),
        };
      }),
    };
  }

  private async responsesByQuestion(eventId: string) {
    const answers = await this.prisma.rsvpAnswer.findMany({
      where: { rsvp: { guest: { eventId, anonymizedAt: null } } },
      take: LEGACY_REPORT_ROW_LIMIT + 1,
      orderBy: [{ rsvp: { guest: { household: { name: 'asc' } } } }, { rsvp: { guest: { firstName: 'asc' } } }, { id: 'asc' }],
      select: {
        questionId: true,
        value: true,
        rsvp: {
          select: {
            status: true,
            guest: { select: { id: true, firstName: true, lastName: true, household: { select: { name: true } } } },
          },
        },
      },
    });
    if (answers.length > LEGACY_REPORT_ROW_LIMIT) {
      throw new BadRequestException('Report exceeds 5000 answers; use the paged answers at answers/questions');
    }

    const byQuestion = new Map<string, ResponseRow[]>();
    for (const answer of answers) {
      const { guest, status } = answer.rsvp;
      const row = {
        guestId: guest.id,
        name: [guest.firstName, guest.lastName].filter(Boolean).join(' '),
        household: guest.household.name,
        status,
        value: answer.value as unknown,
      };
      const responses = byQuestion.get(answer.questionId) ?? [];
      responses.push(row);
      byQuestion.set(answer.questionId, responses);
    }
    return byQuestion;
  }
}

interface ResponseRow {
  guestId: string;
  name: string;
  household: string;
  status: RsvpStatus;
  value: unknown;
}
