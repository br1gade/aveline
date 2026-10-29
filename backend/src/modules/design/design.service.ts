import { bindTemplateMaterialization } from './templates/template-materialization';
import { lockOrganizationStanding, requireCurrentEventPermission } from '../../infra/auth/access-locks';
import { assertAuthoredTheme } from './templates/template-theme';
import { lockLiveEvent } from '../events/event-lock';
import { DomainHttpException } from '../../common/domain-http.exception';
import { TemplateAdoptionService } from './templates/template-adoption.service';
import { listEventTemplates, selectAvailableTemplate } from './templates/template-reader';
import { versionStatement } from '../guest-contributions/statements';
import { countQuestionAnswers } from '../ticketing/checkout-questions';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BlockType, Prisma, QuestionType } from '@prisma/client';
import { CacheService } from '../../infra/cache/cache.service';
import { blockMediaProblem } from './block-media';
import { mergeTranslations } from './translated-content';
import { lockRow } from '../../common/row-lock';
import { languageKeysProblem } from '../../common/field-translations';
import { BUILT_IN_FIELDS, configProblem, fieldOf, mergeConfig } from '../rsvp/rsvp-fields';
import { TemplateRules, assertBlockEdit, variantProblem } from './block-rules';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChooseTemplateDto,
  ReorderQuestionsDto,
  UpdateBlockDto,
  UpdateRsvpFieldsDto,
  UpdateThemeDto,
  UpdateQuestionDto,
  UpsertQuestionDto,
} from './dto/design.dto';
import { Palette, mergeTheme, validateTheme } from './theme';

/** Choice questions are meaningless without choices. */
const CHOICE_TYPES: readonly QuestionType[] = [
  QuestionType.SINGLE_CHOICE,
  QuestionType.MULTI_CHOICE,
];

@Injectable()
export class DesignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly adoption: TemplateAdoptionService,
  ) {}

  /** The template catalogue a designer picks from. */
  async listTemplates(eventId: string) {
    return listEventTemplates(this.prisma, eventId);
  }

  /**
   * Switches template.
   *
   * Blocks the new template does not support are disabled rather than deleted,
   * because switching back must not have destroyed the host's copy. The theme
   * is reset to the new template's default: carrying over a font the new
   * template does not ship would produce exactly the broken render that theme
   * validation exists to prevent.
   */
  async chooseTemplate(slug: string, dto: ChooseTemplateDto, userId: string) {
    if (dto.templateVersionId) {
      if (!dto.previewId || !dto.expectedTemplateVersionId || !dto.expectedDesignRevision || !dto.idempotencyKey) {
        throw new DomainHttpException('TEMPLATE_PREVIEW_REQUIRED', 'Exact version adoption requires previewId, expectedTemplateVersionId, expectedDesignRevision and idempotencyKey');
      }
      return this.adoption.apply(userId, slug, { targetVersionId: dto.templateVersionId, templateKey: dto.templateKey,
        previewId: dto.previewId, expectedTemplateVersionId: dto.expectedTemplateVersionId, expectedDesignRevision: dto.expectedDesignRevision, idempotencyKey: dto.idempotencyKey });
    }
    const invitation = await this.prisma.invitation.findUniqueOrThrow({ where: { slug }, include: { templateVersion: true } });
    if (invitation.templateVersion.templateId === invitation.templateId) {
      const current = await this.prisma.designTemplate.findUniqueOrThrow({ where: { id: invitation.templateId } });
      if (current.key === dto.templateKey) return this.describe(slug);
    }
    await this.prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId: invitation.organizationId });
      const template = await selectAvailableTemplate(tx, { organizationId: invitation.organizationId, templateKey: dto.templateKey });
      if (!template) throw new NotFoundException('No such template');
      if (template.provenance !== 'LEGACY_BASELINE') throw new DomainHttpException('TEMPLATE_PREVIEW_REQUIRED', 'Explicit version preview and confirmation required');
      await lockLiveEvent(tx, invitation.eventId);
      await tx.$queryRaw`SELECT id FROM invitations WHERE id=${invitation.id} FOR UPDATE`;
      await requireCurrentEventPermission(tx, { actor: { userId }, eventId: invitation.eventId, permission: 'invitation:design' });
      await bindTemplateMaterialization(tx, { previewId: '', invitationId: invitation.id, targetVersionId: template.templateVersionId, hasArtwork: false });
      await tx.invitation.update({ where: { id: invitation.id }, data: {
        templateId: template.id, templateVersionId: template.templateVersionId,
        templateOwnerScopeKey: template.ownerScopeKey, theme: template.defaultTheme as Prisma.InputJsonValue,
      } });
      if (template.supportedBlocks.length > 0) await tx.invitationBlock.updateMany({
        where: { invitationId: invitation.id, type: { notIn: template.supportedBlocks } }, data: { enabled: false },
      });
      await clearUnofferedVariants(tx, invitation.id, template);
    });

    await this.cache.invalidateInvitation(slug);
    return this.describe(slug);
  }

  /**
   * Changes the theme, validated against the template that must render it.
   *
   * Omitted fields are kept, and the whole update is rejected or applied
   * together — a half-applied theme is a page with one new font and one old
   * colour, which looks like a bug to the person who paid for it.
   */
  async updateTheme(slug: string, dto: UpdateThemeDto) {
    const identity = await this.requireInvitation(slug);
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockLiveEvent(tx, identity.eventId);
      await tx.$queryRaw`SELECT id FROM invitations WHERE id=${identity.id} FOR UPDATE`;
      const invitation = await tx.invitation.findUniqueOrThrow({ where: { id: identity.id }, select: {
        theme: true, templateVersion: { select: { allowedFonts: true, palettes: true, provenance: true, rendererManifest: true } },
      } });
      const merged = mergeTheme(asObject(invitation.theme), { ...dto });
      const result = validateTheme(merged, { allowedFonts: invitation.templateVersion.allowedFonts, palettes: asPalettes(invitation.templateVersion.palettes) });
      if (!result.isValid) throw new BadRequestException(result.errors);
      assertAuthoredTheme(merged, invitation.templateVersion);
      return tx.invitation.update({ where: { id: identity.id }, data: { theme: result.theme as Prisma.InputJsonValue }, select: { theme: true } });
    });
    await this.cache.invalidateInvitation(slug); return { slug, theme: updated.theme };
  }

  /**
   * Edits one block's content.
   *
   * Creating a block is `PATCH /invitations/:slug/arrangement` — the
   * arrangement call owns which blocks exist and in what order, so there is
   * exactly one place that decides it. This call owns what is inside one.
   */
  async updateBlock(slug: string, type: BlockType, dto: UpdateBlockDto) {
    const invitation = await this.requireInvitation(slug);
    assertLanguages(['content', dto.content]);

    if (dto.assetIds) await this.assertAttachable(invitation.eventId, type, dto.assetIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      await lockLiveEvent(tx, invitation.eventId);
      await tx.$queryRaw`SELECT id FROM invitations WHERE id=${invitation.id} FOR UPDATE`;
      const current = await tx.invitation.findUniqueOrThrow({ where: { id: invitation.id }, select: { templateVersion: { select: { supportedBlocks: true, blockVariants: true } } } });
      assertBlockEdit(current.templateVersion, type, dto);
      const block = await tx.invitationBlock.findUnique({
        where: { invitationId_type: { invitationId: invitation.id, type } },
        select: { id: true },
      });
      if (!block) {
        throw new NotFoundException(`This invitation has no ${type} block; add it through the arrangement call first`);
      }
      // Merged under the row's lock, so a co-host editing another language
      // at the same moment is merged into rather than written over.
      await lockRow(tx, 'invitation_blocks', block.id);
      if (dto.assetIds) await shareLockAssets(tx, dto.assetIds);
      const { content } = await tx.invitationBlock.findUniqueOrThrow({ where: { id: block.id }, select: { content: true } });
      return tx.invitationBlock.update({
        where: { id: block.id },
        data: {
          content: dto.content ? (mergeTranslations(content, dto.content) as Prisma.InputJsonValue) : undefined,
          settings: dto.settings as Prisma.InputJsonValue | undefined,
          // null is the template's default layout; only omitted leaves it.
          variant: dto.variant === undefined ? undefined : dto.variant,
          assetIds: dto.assetIds ?? undefined,
          enabled: dto.enabled ?? undefined,
        },
      });
    });

    await this.cache.invalidateInvitation(slug);
    return {
      type: updated.type,
      enabled: updated.enabled,
      variant: updated.variant,
      assetIds: updated.assetIds,
      content: updated.content,
      settings: updated.settings,
    };
  }

  /**
   * How the built-in RSVP questions are asked — which are on, and fixed
   * choices for dietary and drink. Each question sent replaces its settings;
   * the rest are kept. See `rsvp/rsvp-fields.ts` for why.
   */
  async updateRsvpFields(slug: string, dto: UpdateRsvpFieldsDto) {
    const edit = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
    const problem = configProblem(edit);
    if (problem) throw new BadRequestException(problem);

    const { id } = await this.requireInvitation(slug);
    const merged = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'invitations', id);
      const { rsvpFields } = await tx.invitation.findUniqueOrThrow({ where: { id }, select: { rsvpFields: true } });
      const next = mergeConfig(rsvpFields, edit);
      await tx.invitation.update({ where: { id }, data: { rsvpFields: next as Prisma.InputJsonValue } });
      return next;
    });
    await this.cache.invalidateInvitation(slug);
    return Object.fromEntries(BUILT_IN_FIELDS.map((field) => [field, fieldOf(merged, field)]));
  }

  // ── RSVP questions ───────────────────────────────────────────────────

  async listQuestions(slug: string) {
    const invitation = await this.requireInvitation(slug);

    const questions = await this.prisma.rsvpQuestion.findMany({
      where: { invitationId: invitation.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    return questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      options: question.options,
      required: question.required,
      sortOrder: question.sortOrder,
      statementVersionId: question.statementVersionId,
    }));
  }

  async addQuestion(slug: string, dto: UpsertQuestionDto) {
    const invitation = await this.requireInvitation(slug);
    assertQuestionIsAnswerable(dto);

    const question = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'invitations', invitation.id);
      const questions = await tx.rsvpQuestion.aggregate({ where: { invitationId: invitation.id }, _count: true, _max: { sortOrder: true } });
      if (questions._count >= 1000) throw new BadRequestException('questions: at most 1000 per invitation');
      const created = await tx.rsvpQuestion.create({ data: {
        invitationId: invitation.id, type: dto.type, prompt: dto.prompt as Prisma.InputJsonValue,
        options: (dto.options ?? []) as Prisma.InputJsonValue, required: dto.required ?? false,
        sortOrder: (questions._max.sortOrder ?? 0) + 1,
      } });
      return { ...created, statementVersionId: await versionStatement(tx, created) };
    });

    await this.cache.invalidateInvitation(slug);
    return question;
  }

  /**
   * Changes what is sent and leaves the rest. A PATCH that left `required`
   * out used to make the question optional, and one that left `options` out
   * emptied a choice question. The merged question must still be answerable.
   */
  async updateQuestion(slug: string, questionId: string, dto: UpdateQuestionDto) {
    const { id } = await this.requireQuestion(slug, questionId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Locked, so two edits merge one after the other, and an answer cannot
      // arrive between the shape check and the write.
      await lockRow(tx, 'rsvp_questions', id);
      const question = await tx.rsvpQuestion.findUniqueOrThrow({ where: { id } });
      // One language at a time, as block copy is: correcting the English
      // prompt used to delete the Armenian one.
      const prompt = dto.prompt ? mergeTranslations(question.prompt, dto.prompt) : asObject(question.prompt);
      const options = (dto.options ? mergeTranslations(question.options, dto.options) : (question.options ?? [])) as Prisma.InputJsonValue;
      const type = dto.type ?? question.type;
      assertQuestionIsAnswerable({ type, prompt, options: asObject(options as Prisma.JsonValue) });
      const answers = await countQuestionAnswers(tx, id);
      assertAnsweredQuestionKeepsShape(answers, question, { type, options });

      const changed = await tx.rsvpQuestion.update({
        where: { id }, data: { type, prompt: prompt as Prisma.InputJsonValue, options, required: dto.required ?? question.required },
      });
      return { ...changed, statementVersionId: await versionStatement(tx, changed) };
    });

    await this.cache.invalidateInvitation(slug);
    return updated;
  }

  /**
   * Removes a question nobody has answered.
   *
   * Once an answer exists, deleting would discard what a guest told the host —
   * so a question with answers is refused and the host is told to stop asking
   * it instead.
   */
  async removeQuestion(slug: string, questionId: string) {
    const question = await this.requireQuestion(slug, questionId);

    await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'invitations', question.invitationId);
      // Locked before counting: an answer arriving between the count and the
      // delete was cascaded away (B87). The lock conflicts with the one an
      // answer's foreign key takes, so the two now run one after the other.
      await tx.$queryRaw`SELECT id FROM rsvp_questions WHERE id = ${question.id} FOR UPDATE`;
      const answers = await countQuestionAnswers(tx, question.id);
      if (answers > 0) {
        throw new BadRequestException(
          `${answers} guest(s) have answered this question; deleting it would discard their answers. ` +
            'Make it optional instead.',
        );
      }
      await tx.rsvpQuestion.delete({ where: { id: question.id } });
    });
    await this.cache.invalidateInvitation(slug);
    return { ok: true as const };
  }

  async reorderQuestions(slug: string, dto: ReorderQuestionsDto) {
    const invitation = await this.requireInvitation(slug);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'invitations', invitation.id);
      const current = await tx.rsvpQuestion.findMany({ where: { invitationId: invitation.id }, select: { id: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
      const ids = current.map((question) => question.id);
      if (JSON.stringify(ids) !== JSON.stringify(dto.expectedOrder)) {
        throw new ConflictException('expectedOrder: questions changed; reload them before reordering');
      }
      const wanted = new Set(dto.questionIds);
      if (wanted.size !== ids.length || dto.questionIds.length !== ids.length || ids.some((id) => !wanted.has(id))) {
        throw new BadRequestException('questionIds: include every current question exactly once');
      }
      if (ids.length > 0) await tx.$executeRaw`
        UPDATE rsvp_questions SET "sortOrder" = requested.position::integer - 1
        FROM unnest(${dto.questionIds}::text[]) WITH ORDINALITY AS requested(id, position)
        WHERE rsvp_questions.id = requested.id AND rsvp_questions."invitationId" = ${invitation.id}`;
      return tx.rsvpQuestion.findMany({ where: { invitationId: invitation.id }, orderBy: { sortOrder: 'asc' } });
    });
    await this.cache.invalidateInvitation(slug);
    return result;
  }

  private async requireInvitation(slug: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      select: { id: true, eventId: true },
    });
    if (!invitation) throw new NotFoundException(`No invitation at "${slug}"`);
    return invitation;
  }

  private async requireQuestion(slug: string, questionId: string) {
    const invitation = await this.requireInvitation(slug);
    const question = await this.prisma.rsvpQuestion.findFirst({
      where: { id: questionId, invitationId: invitation.id },
    });
    if (!question) throw new NotFoundException('No such question on this invitation');
    return question;
  }

  /**
   * The assets must be this event's, and of a kind the block can show.
   *
   * Another event's asset would put one couple's photos on another's page.
   */
  private async assertAttachable(eventId: string, type: BlockType, assetIds: string[]): Promise<void> {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: assetIds }, eventId },
      select: { id: true, kind: true },
    });
    if (assets.length !== new Set(assetIds).size) {
      throw new BadRequestException('assetIds: one or more assets do not belong to this event');
    }

    const problem = blockMediaProblem(type, assets);
    if (problem) throw new BadRequestException(problem);
  }

  private async describe(slug: string) {
    const invitation = await this.prisma.invitation.findUniqueOrThrow({
      where: { slug },
      select: {
        slug: true,
        theme: true,
        status: true,
        template: { select: { key: true, name: true } },
        blocks: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { type: true, enabled: true, variant: true, sortOrder: true },
        },
      },
    });
    return invitation;
  }
}

function assertQuestionIsAnswerable(dto: UpsertQuestionDto): void {
  assertLanguages(['prompt', dto.prompt], ['options', dto.options]);
  if (Object.keys(dto.prompt).length === 0) {
    throw new BadRequestException('prompt: give the question in at least one language');
  }

  if (!CHOICE_TYPES.includes(dto.type)) return;

  const lengths = choiceListLengths(dto.options);
  if (lengths.length === 0 || Math.max(...lengths) === 0) {
    throw new BadRequestException(`options: a ${dto.type} question needs choices to pick from`);
  }
  // A choice is stored by position, so every language must offer the same
  // positions; with lists of different lengths the shorter one won.
  if (new Set(lengths).size > 1) {
    throw new BadRequestException('options: every language needs the same number of choices');
  }
}

/** How many choices each language's list has. */
function choiceListLengths(options: unknown): number[] {
  if (!options || typeof options !== 'object') return [];
  return Object.values(options as Record<string, unknown>).filter(Array.isArray).map((list) => list.length);
}

/**
 * Once guests have answered, a question may be reworded and grow, never
 * shrink or change kind (decided 10 October 2026, D10). Answers are stored by
 * position: removing "Meat" from Meat/Fish/Vegan turned every "Fish" into
 * "Vegan", silently.
 */
function assertAnsweredQuestionKeepsShape(
  answers: number,
  before: { type: QuestionType; options: Prisma.JsonValue },
  after: { type: QuestionType; options: unknown },
): void {
  if (answers === 0) return;
  const who = `${answers} guest(s) have answered it`;
  if (after.type !== before.type) {
    throw new BadRequestException(`type: ${who}; its type cannot change. Add a new question instead`);
  }
  const had = Math.min(...choiceListLengths(before.options), Number.POSITIVE_INFINITY);
  if (Number.isFinite(had) && choiceListLengths(after.options).some((length) => length < had)) {
    throw new BadRequestException(`options: ${who}; options can be reworded or added at the end, not removed or reordered`);
  }
}

/** A JSON object column as a record; anything else as empty. */
/**
 * Holds the files being attached until the block is written: removing one
 * at the same moment waits, then sees it shown and refuses — or, if it went
 * first, the file is gone and this refuses (B87).
 */
async function shareLockAssets(tx: Prisma.TransactionClient, assetIds: string[]): Promise<void> {
  if (assetIds.length === 0) return;
  const found = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM media_assets WHERE id IN (${Prisma.join(assetIds)}) FOR SHARE`;
  if (found.length !== new Set(assetIds).size) {
    throw new BadRequestException('assetIds: one of these files was just removed');
  }
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asPalettes(value: Prisma.JsonValue): Palette[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => (isPalette(entry) ? [entry] : []));
}

function isPalette(value: unknown): value is Palette {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { name?: unknown; colors?: unknown };
  return typeof candidate.name === 'string' && Array.isArray(candidate.colors);
}

/** A layout the new template does not offer falls back to the default, rather than to a guess. */
async function clearUnofferedVariants(tx: Prisma.TransactionClient, invitationId: string, template: TemplateRules): Promise<void> {
  const blocks = await tx.invitationBlock.findMany({
    where: { invitationId, variant: { not: null } },
    select: { id: true, type: true, variant: true },
  });
  const unoffered = blocks.filter((block) => variantProblem(template, block.type, block.variant) !== null);
  if (unoffered.length === 0) return;
  await tx.invitationBlock.updateMany({ where: { id: { in: unoffered.map((block) => block.id) } }, data: { variant: null } });
}

/** Each translated field keyed by languages only, or a 400 naming the field. */
function assertLanguages(...fields: [string, Record<string, unknown> | undefined][]): void {
  for (const [field, content] of fields) {
    const problem = languageKeysProblem(field, content);
    if (problem) throw new BadRequestException(problem);
  }
}
