import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from '../../infra/analytics/analytics.service';
import { AnswersSheetService } from './answers-sheet.service';
import { OperationsService } from './operations.service';
import { LEGACY_REPORT_QUESTION_LIMIT, LEGACY_REPORT_ROW_LIMIT } from './dto/report-query.dto';

const question = { id: 'question', type: 'BOOLEAN', required: false, prompt: { en: 'Coming?' }, options: null };
const guest = { id: 'guest', firstName: 'Guest', lastName: null, household: { name: 'Family' } };

function database(questionCount: number, answerCount: number) {
  return {
    event: { findUnique: jest.fn().mockResolvedValue({ locales: ['en'], defaultLocale: 'en', invitation: {
      questions: Array.from({ length: questionCount }, (_, index) => ({ ...question, id: index === 0 ? 'question' : `q-${index}` })),
    } }) },
    rsvpAnswer: { findMany: jest.fn().mockResolvedValue(Array.from({ length: answerCount }, () => ({
      questionId: 'question', value: true, rsvp: { status: 'ATTENDING', guest },
    }))) },
    rsvp: { findMany: jest.fn().mockResolvedValue(Array.from({ length: answerCount }, () => ({
      guest, message: 'Best wishes', respondedAt: null,
    }))) },
  };
}

describe('legacy operational report limits', () => {
  it('returns every question at the legacy limit', async () => {
    const service = new AnswersSheetService(database(LEGACY_REPORT_QUESTION_LIMIT, 0) as unknown as PrismaService);
    expect((await service.answersSheet('event')).questions).toHaveLength(LEGACY_REPORT_QUESTION_LIMIT);
  });
  it('refuses rather than truncating questions beyond the legacy limit', async () => {
    const service = new AnswersSheetService(database(LEGACY_REPORT_QUESTION_LIMIT + 1, 0) as unknown as PrismaService);
    await expect(service.answersSheet('event')).rejects.toThrow('use the paged answers');
  });
  it('returns every answer at the legacy limit', async () => {
    const service = new AnswersSheetService(database(1, LEGACY_REPORT_ROW_LIMIT) as unknown as PrismaService);
    expect((await service.answersSheet('event')).questions[0].responses).toHaveLength(LEGACY_REPORT_ROW_LIMIT);
  });
  it('refuses rather than truncating answers beyond the legacy limit', async () => {
    const service = new AnswersSheetService(database(1, LEGACY_REPORT_ROW_LIMIT + 1) as unknown as PrismaService);
    await expect(service.answersSheet('event')).rejects.toThrow('use the paged answers');
  });
  it('returns every guest-book entry at the legacy limit', async () => {
    const service = new OperationsService(database(0, LEGACY_REPORT_ROW_LIMIT) as unknown as PrismaService, {} as AnalyticsService);
    expect(await service.guestBook('event')).toHaveLength(LEGACY_REPORT_ROW_LIMIT);
  });
  it('refuses rather than truncating guest-book entries beyond the legacy limit', async () => {
    const service = new OperationsService(database(0, LEGACY_REPORT_ROW_LIMIT + 1) as unknown as PrismaService, {} as AnalyticsService);
    await expect(service.guestBook('event')).rejects.toThrow('use the paged guest book');
  });
});
