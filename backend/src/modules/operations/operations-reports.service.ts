import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolvePaging, toPage } from '../../common/dto/pagination.dto';
import { negotiateLocale, resolveTranslation } from '../../common/locale';
import { PrismaService } from '../../prisma/prisma.service';
import { formatAnswer, optionLabels } from '../rsvp/answer-display';
import { readOptionCounts, reportTally } from './answer-report-tallies';
import { ReportQueryDto } from './dto/report-query.dto';

const QUESTION_FIELDS = { id: true, type: true, required: true, prompt: true, options: true, sortOrder: true } as const;
const ANSWER_FIELDS = { id: true, value: true, rsvp: { select: { status: true,
  guest: { select: { id: true, firstName: true, lastName: true, household: { select: { name: true } } } } } } } as const;

@Injectable()
export class OperationsReportsService {
  constructor(private readonly prisma: PrismaService) {}

  questions(eventId: string, query: ReportQueryDto) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.context(tx, eventId, query.locale);
      const paging = resolvePaging(query);
      const where = { invitation: { eventId } };
      const [rows, total] = await Promise.all([
        tx.rsvpQuestion.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], ...paging,
          select: { ...QUESTION_FIELDS, _count: { select: { answers: { where: { rsvp: { guest: { eventId, anonymizedAt: null } } } } } } } }),
        tx.rsvpQuestion.count({ where }),
      ]);
      const counts = await readOptionCounts(tx, eventId, rows.map((question) => question.id));
      const items = rows.map((question) => {
        const labels = optionLabels(question.options, context.locale, context.defaultLocale);
        return { id: question.id, type: question.type, required: question.required,
          prompt: resolveTranslation<string>(question.prompt, context.locale, context.defaultLocale), options: labels,
          answered: question._count.answers, tally: reportTally(question, labels, counts, context.locale) };
      });
      return { locale: context.locale, ...toPage(items, total, paging) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  responses(eventId: string, questionId: string, query: ReportQueryDto) {
    return this.prisma.$transaction(async (tx) => {
      const context = await this.context(tx, eventId, query.locale);
      const question = await tx.rsvpQuestion.findFirst({ where: { id: questionId, invitation: { eventId } }, select: QUESTION_FIELDS });
      if (!question) throw new NotFoundException('questionId: no question on this event');
      const paging = resolvePaging(query);
      const where = { questionId, rsvp: { guest: { eventId, anonymizedAt: null } } };
      const [rows, total] = await Promise.all([
        tx.rsvpAnswer.findMany({ where, ...paging, orderBy: [{ rsvp: { guest: { household: { name: 'asc' } } } },
          { rsvp: { guest: { firstName: 'asc' } } }, { id: 'asc' }], select: ANSWER_FIELDS }),
        tx.rsvpAnswer.count({ where }),
      ]);
      const labels = optionLabels(question.options, context.locale, context.defaultLocale);
      const items = rows.map((answer) => ({ id: answer.id, guestId: answer.rsvp.guest.id,
        name: [answer.rsvp.guest.firstName, answer.rsvp.guest.lastName].filter(Boolean).join(' '),
        household: answer.rsvp.guest.household.name, status: answer.rsvp.status, value: answer.value,
        display: formatAnswer(question, answer.value, labels, context.locale) }));
      return { questionId, locale: context.locale, ...toPage(items, total, paging) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  guestBook(eventId: string, query: ReportQueryDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.context(tx, eventId, query.locale);
      const paging = resolvePaging(query);
      const where = { guest: { eventId, anonymizedAt: null }, message: { not: null } };
      const [rows, total] = await Promise.all([
        tx.rsvp.findMany({ where, ...paging, orderBy: [{ respondedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
          select: { id: true, guestId: true, message: true, respondedAt: true, guest: { select: { firstName: true, lastName: true } } } }),
        tx.rsvp.count({ where }),
      ]);
      const items = rows.map((row) => ({ id: row.id, guestId: row.guestId,
        from: [row.guest.firstName, row.guest.lastName].filter(Boolean).join(' '), message: row.message, at: row.respondedAt }));
      return toPage(items, total, paging);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async context(tx: Prisma.TransactionClient, eventId: string, locale?: string) {
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { defaultLocale: true, locales: true } });
    if (!event) throw new NotFoundException('eventId: no such event');
    return { locale: negotiateLocale(locale, event.locales, event.defaultLocale), defaultLocale: event.defaultLocale };
  }
}
