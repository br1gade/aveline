import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BlockType, Prisma, QuestionType } from '@prisma/client';
import { CacheService } from '../../infra/cache/cache.service';
import { blockMediaProblem } from './block-media';
import { mergeTranslations } from './translated-content';
import { BUILT_IN_FIELDS, configProblem, fieldOf, mergeConfig } from '../rsvp/rsvp-fields';
import { TemplateRules, assertBlockEdit, variantProblem } from './block-rules';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ChooseTemplateDto,
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
  ) {}

  /** The template catalogue a designer picks from. */
  async listTemplates() {
    const templates = await this.prisma.designTemplate.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return templates.map((template) => ({
      key: template.key,
      name: template.name,
      allowedFonts: template.allowedFonts,
      palettes: template.palettes,
      supportedBlocks: template.supportedBlocks,
      // The layouts each block may take; `variant` must be one of these or null.
      blockVariants: template.blockVariants,
      defaultTheme: template.defaultTheme,
    }));
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
  async chooseTemplate(slug: string, dto: ChooseTemplateDto) {
    const [invitation, template] = await Promise.all([
      this.requireInvitation(slug),
      this.prisma.designTemplate.findFirst({ where: { key: dto.templateKey, isActive: true } }),
    ]);
    if (!template) throw new NotFoundException(`No template "${dto.templateKey}" is available`);

    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { templateId: template.id, theme: template.defaultTheme as Prisma.InputJsonValue },
      });

      if (template.supportedBlocks.length > 0) {
        await tx.invitationBlock.updateMany({
          where: { invitationId: invitation.id, type: { notIn: template.supportedBlocks } },
          data: { enabled: false },
        });
      }
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
    const invitation = await this.prisma.invitation.findUnique({
      where: { slug },
      select: {
        id: true,
        theme: true,
        template: { select: { allowedFonts: true, palettes: true } },
      },
    });
    if (!invitation) throw new NotFoundException(`No invitation at "${slug}"`);

    const merged = mergeTheme(asObject(invitation.theme), { ...dto });
    const result = validateTheme(merged, {
      allowedFonts: invitation.template.allowedFonts,
      palettes: asPalettes(invitation.template.palettes),
    });

    if (!result.isValid) throw new BadRequestException(result.errors);

    const updated = await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { theme: result.theme as Prisma.InputJsonValue },
      select: { theme: true },
    });

    await this.cache.invalidateInvitation(slug);
    return { slug, theme: updated.theme };
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
    const template = await this.prisma.designTemplate.findFirstOrThrow({
      where: { invitations: { some: { id: invitation.id } } },
      select: { supportedBlocks: true, blockVariants: true },
    });
    assertBlockEdit(template, type, dto);

    const block = await this.prisma.invitationBlock.findUnique({
      where: { invitationId_type: { invitationId: invitation.id, type } },
    });
    if (!block) {
      throw new NotFoundException(
        `This invitation has no ${type} block; add it through the arrangement call first`,
      );
    }

    if (dto.assetIds) await this.assertAttachable(invitation.eventId, type, dto.assetIds);

    const updated = await this.prisma.invitationBlock.update({
      where: { id: block.id },
      data: {
        content: dto.content
          ? (mergeTranslations(block.content, dto.content) as Prisma.InputJsonValue)
          : undefined,
        settings: dto.settings as Prisma.InputJsonValue | undefined,
        variant: dto.variant ?? undefined,
        assetIds: dto.assetIds ?? undefined,
        enabled: dto.enabled ?? undefined,
      },
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

    const invitation = await this.prisma.invitation.findUnique({ where: { slug }, select: { id: true, rsvpFields: true } });
    if (!invitation) throw new NotFoundException(`No invitation at "${slug}"`);

    const merged = mergeConfig(invitation.rsvpFields, edit);
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { rsvpFields: merged as Prisma.InputJsonValue },
    });
    await this.cache.invalidateInvitation(slug);
    return Object.fromEntries(BUILT_IN_FIELDS.map((field) => [field, fieldOf(merged, field)]));
  }

  // ── RSVP questions ───────────────────────────────────────────────────

  async listQuestions(slug: string) {
    const invitation = await this.requireInvitation(slug);

    const questions = await this.prisma.rsvpQuestion.findMany({
      where: { invitationId: invitation.id },
      orderBy: { sortOrder: 'asc' },
    });

    return questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      options: question.options,
      required: question.required,
      sortOrder: question.sortOrder,
    }));
  }

  async addQuestion(slug: string, dto: UpsertQuestionDto) {
    const invitation = await this.requireInvitation(slug);
    assertQuestionIsAnswerable(dto);

    const last = await this.prisma.rsvpQuestion.findFirst({
      where: { invitationId: invitation.id },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const question = await this.prisma.rsvpQuestion.create({
      data: {
        invitationId: invitation.id,
        type: dto.type,
        prompt: dto.prompt as Prisma.InputJsonValue,
        options: (dto.options ?? []) as Prisma.InputJsonValue,
        required: dto.required ?? false,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
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
    const question = await this.requireQuestion(slug, questionId);
    const prompt = dto.prompt ?? asObject(question.prompt);
    const options = (dto.options ?? question.options ?? []) as Prisma.InputJsonValue;
    const type = dto.type ?? question.type;
    assertQuestionIsAnswerable({ type, prompt, options: dto.options ?? asObject(question.options) });

    const updated = await this.prisma.rsvpQuestion.update({
      where: { id: question.id },
      data: { type, prompt: prompt as Prisma.InputJsonValue, options, required: dto.required ?? question.required },
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

    const answers = await this.prisma.rsvpAnswer.count({ where: { questionId: question.id } });
    if (answers > 0) {
      throw new BadRequestException(
        `${answers} guest(s) have answered this question; deleting it would discard their answers. ` +
          'Make it optional instead.',
      );
    }

    await this.prisma.rsvpQuestion.delete({ where: { id: question.id } });
    await this.cache.invalidateInvitation(slug);
    return { ok: true as const };
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
          orderBy: { sortOrder: 'asc' },
          select: { type: true, enabled: true, variant: true, sortOrder: true },
        },
      },
    });
    return invitation;
  }
}

function assertQuestionIsAnswerable(dto: UpsertQuestionDto): void {
  if (Object.keys(dto.prompt).length === 0) {
    throw new BadRequestException('prompt: give the question in at least one language');
  }

  if (!CHOICE_TYPES.includes(dto.type)) return;

  const options = dto.options ?? {};
  const hasChoices = Object.values(options).some(
    (choices) => Array.isArray(choices) && choices.length > 0,
  );
  if (!hasChoices) {
    throw new BadRequestException(`options: a ${dto.type} question needs choices to pick from`);
  }
}

/** A JSON object column as a record; anything else as empty. */
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
