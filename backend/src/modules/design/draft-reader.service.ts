import { pinnedTemplate } from './templates/template-content';
import { hasInvitationExpired, LIFETIME_SELECT } from '../invitations/lifetime';
import { Injectable, NotFoundException } from '@nestjs/common';
import { BlockType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { publishBlockers } from '../invitations/publishing';
import { BUILT_IN_FIELDS, fieldOf } from '../rsvp/rsvp-fields';

const draftSelect = {
  ...LIFETIME_SELECT,
  slug: true,
  designRevision: true,
  status: true,
  theme: true,
  rsvpFields: true,
  eventId: true,
  templateVersion: true,
  template: {
    select: { key: true, name: true, allowedFonts: true, palettes: true, supportedBlocks: true, defaultTheme: true },
  },
  event: {
    select: {
      id: true,
      title: true,
      hostsLabel: true,
      startsAt: true,
      timezone: true,
      locales: true,
      defaultLocale: true,
      translations: true,
      venues: { select: { address: true } },
    },
  },
  blocks: {
    orderBy: { sortOrder: 'asc' },
    select: { type: true, sortOrder: true, enabled: true, variant: true, content: true, settings: true, assetIds: true },
  },
  questions: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      statementVersionId: true,
      required: true,
      sortOrder: true,
      prompt: true,
      options: true,
      _count: { select: { answers: true } },
    },
  },
} satisfies Prisma.InvitationSelect;

type Draft = Prisma.InvitationGetPayload<{ select: typeof draftSelect }>;
export interface DraftMedia {
  id: string;
  url: string;
  kind: string;
  altText: Prisma.JsonValue;
  width: number | null;
  height: number | null;
  variants: Prisma.JsonValue;
}

/**
 * The invitation as the host is editing it.
 *
 * Distinct from the guest page in every way that matters to an editor: it
 * includes a draft, every block whether switched on or not, every language
 * of every block and question, and the settings. The guest page resolves one
 * language and drops the rest, which is right for a guest and lost the host's
 * work every time an editor reloaded.
 *
 * Also says what still stands between the host and publishing, so the editor
 * can show it while they work rather than only when they press publish.
 */
@Injectable()
export class DraftReaderService {
  constructor(private readonly prisma: PrismaService) {}

  async read(slug: string) {
    const found = await this.prisma.invitation.findUnique({ where: { slug }, select: draftSelect });
    if (!found) throw new NotFoundException(`No invitation at "${slug}"`);

    const draft = { ...found, template: { ...pinnedTemplate(found), id: found.templateVersion.templateId } };
    const media = await this.loadMedia(draft);
    const blocks = draft.blocks.map((block) => ({
      ...block,
      media: block.assetIds.flatMap((id) => media.get(id) ?? []),
    }));

    return {
      slug: draft.slug,
      status: draft.status,
      firstPublishedAt: draft.firstPublishedAt, lifetimeDays: draft.lifetimeDays, lifetimeSource: draft.lifetimeSource,
      lifetimePlanKey: draft.lifetimePlanKey, expiresAt: draft.expiresAt, isExpired: hasInvitationExpired(draft),
      event: { ...draft.event, venues: undefined },
      template: { key: draft.template.key, name: draft.template.name, allowedFonts: draft.template.allowedFonts, palettes: draft.template.palettes, supportedBlocks: draft.template.supportedBlocks, versionId: draft.templateVersion.id, versionNumber: draft.templateVersion.versionNumber },
      designRevision: String(draft.designRevision),
      theme: draft.theme,
      rsvpFields: Object.fromEntries(BUILT_IN_FIELDS.map((field) => [field, fieldOf(draft.rsvpFields, field)])),
      // What the page actually renders with: the template's defaults under the host's choices.
      effectiveTheme: { ...asRecord(draft.template.defaultTheme), ...asRecord(draft.theme) },
      coverUrl: firstMediaUrl(blocks, BlockType.HERO),
      musicUrl: firstMediaUrl(blocks, BlockType.MUSIC),
      blocks,
      questions: draft.questions.map(({ _count, ...question }) => ({ ...question, answerCount: _count.answers })),
      publishBlockers: publishBlockers(
        { status: draft.status, blocks: draft.blocks, venues: draft.event.venues, startsAt: draft.event.startsAt },
        new Date(),
      ),
    };
  }

  /** Every attached upload in one query, scoped to the event. */
  private async loadMedia(draft: Draft): Promise<Map<string, DraftMedia>> {
    const ids = [...new Set(draft.blocks.flatMap((block) => block.assetIds))];
    if (ids.length === 0) return new Map();

    const assets = await this.prisma.mediaAsset.findMany({
      where: { id: { in: ids }, eventId: draft.eventId },
      select: { id: true, url: true, kind: true, altText: true, width: true, height: true, variants: true },
    });
    return new Map(assets.map((asset) => [asset.id, asset]));
  }
}

/** The first upload on an enabled block of this type — the same rule the guest page uses. */
function firstMediaUrl(blocks: { type: BlockType; enabled: boolean; media: DraftMedia[] }[], type: BlockType) {
  const block = blocks.find((candidate) => candidate.type === type && candidate.enabled);
  return block?.media[0]?.url ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
