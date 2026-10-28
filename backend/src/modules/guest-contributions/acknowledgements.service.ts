import { MEDIA_SELECT } from './guest-media.service';
import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { negotiateLocale, resolveTranslation } from '../../common/locale';
import { SignAcknowledgementDto, ContributionPageDto } from './contribution.dto';
import { lockGuestAccess, readGuestAccess } from './guest-access';
import { writeAcknowledgement } from './acknowledgement-writes';

@Injectable()
export class AcknowledgementsService {
  constructor(private readonly prisma: PrismaService) {}

  async sign(slug: string, token: string, dto: SignAcknowledgementDto) {
    return this.prisma.$transaction(async (tx) => {
      const guest = await lockGuestAccess(tx, slug, token);
      const { subjectGuestIds, ...answer } = dto;
      // A household is explicitly bounded by the request, not by an arbitrary order roster.
      if (!subjectGuestIds?.length || subjectGuestIds.length > 21 || new Set(subjectGuestIds).size !== subjectGuestIds.length) throw new BadRequestException('subjectGuestIds: supply 1–21 distinct household members');
      const records = [];
      for (const subjectId of subjectGuestIds) records.push(await writeAcknowledgement(tx, subjectId, answer, guest.id));
      return { records };
    });
  }

  async forGuest(slug: string, token: string, page: ContributionPageDto) {
    const guest = await readGuestAccess(this.prisma, slug, token);
    const locale = negotiateLocale(guest.locale ?? undefined, guest.event.locales, guest.event.defaultLocale);
    const [questions, records, signatureUploads] = await Promise.all([
      this.prisma.rsvpQuestion.findMany({ where: { invitation: { eventId: guest.eventId }, type: 'SIGNATURE' },
        select: { id: true, required: true, prompt: true, statementVersionId: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.list({ eventId: guest.eventId, OR: [{ signerGuestId: guest.id }, { subject: { householdId: guest.householdId } }] }, page),
      this.prisma.guestMedia.findMany({ where: { eventId: guest.eventId, uploaderGuestId: guest.id, kind: 'SIGNATURE', processingStatus: { not: 'REMOVED' } },
        select: MEDIA_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
    ]);
    return { statements: questions.map((q) => describeStatement(q, locale, guest.event.defaultLocale)), records, signatureUploads,
      nextCursor: records.length === page.limit ? records.at(-1)!.id : null };
  }

  async forHost(eventId: string, page: ContributionPageDto) {
    const records = await this.list({ eventId }, page);
    return { items: records, nextCursor: records.length === page.limit ? records.at(-1)!.id : null };
  }
  private async list(where: Prisma.GuestAcknowledgementWhereInput, page: ContributionPageDto) {
    if (page.after && !await this.prisma.guestAcknowledgement.findFirst({ where: { ...where, id: page.after }, select: { id: true } })) throw new NotFoundException('Unknown acknowledgement cursor');
    return this.prisma.guestAcknowledgement.findMany({ where, select: RECORD_SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit, ...(page.after ? { cursor: { id: page.after }, skip: 1 } : {}) });
  }
  async requireGuestRecord(slug: string, token: string, id: string) {
    const guest = await readGuestAccess(this.prisma, slug, token);
    const record = await this.prisma.guestAcknowledgement.findFirst({ where: { id, eventId: guest.eventId,
      OR: [{ signerGuestId: guest.id }, { subject: { householdId: guest.householdId } }] }, select: { mediaId: true } });
    if (!record?.mediaId) throw new NotFoundException('No drawn acknowledgement here');
    return record.mediaId;
  }
}
const RECORD_SELECT = { id: true, questionId: true, statementVersionId: true, subjectGuestId: true, signerGuestId: true,
  signerName: true, method: true, isRepresentative: true, locale: true, statement: true, mediaId: true, createdAt: true } as const;

export function describeStatement(question: { id: string; statementVersionId: string | null; required: boolean; prompt: Prisma.JsonValue }, requested: string, fallback: string) {
  const translations = question.prompt as Record<string, unknown>;
  const statementLocale = [requested, fallback, ...Object.keys(translations)].find((key) => translations[key] !== undefined) ?? fallback;
  return { questionId: question.id, statementVersionId: question.statementVersionId, required: question.required,
    prompt: resolveTranslation(question.prompt, statementLocale, fallback), locale: requested, statementLocale };
}
