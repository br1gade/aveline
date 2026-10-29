import { AuthoredTemplateVersion, resolvedTemplateTheme } from '../design/templates/resolved-template-theme';
import { BlockType, DesignTemplate, Event, Invitation, InvitationBlock, MediaAsset, RsvpQuestion, TimelineEntry, Venue } from '@prisma/client';
import { translatedField } from '../../common/field-translations';
import { negotiateLocale, resolveTranslation } from '../../common/locale';
import { fieldsForPage } from '../rsvp/rsvp-fields';

export type ContentMedia = Pick<MediaAsset, 'id' | 'url' | 'kind' | 'altText' | 'width' | 'height' | 'variants'>;
type ContentBlock = Pick<InvitationBlock, 'type' | 'sortOrder' | 'variant' | 'settings' | 'content' | 'assetIds'>;
type ContentVenue = Pick<Venue, 'id' | 'role' | 'name' | 'address' | 'translations' | 'latitude' | 'longitude' | 'mapUrl' | 'arriveAt'>;
type ContentEvent = Pick<Event, 'type' | 'title' | 'hostsLabel' | 'translations' | 'startsAt' | 'endsAt' | 'timezone' | 'sideALabel' | 'sideBLabel' | 'locales' | 'defaultLocale'> & {
  venues: ContentVenue[];
  timeline: Pick<TimelineEntry, 'label' | 'occursAt' | 'venueId'>[];
};
export type ContentTemplate = Pick<DesignTemplate, 'id' | 'key' | 'allowedFonts' | 'defaultTheme' | 'supportedBlocks' | 'blockVariants'>;
export type InvitationContent = Pick<Invitation, 'slug' | 'status' | 'expiresAt' | 'theme' | 'rsvpFields'> & {
  template: ContentTemplate;
  templateVersion?: AuthoredTemplateVersion;
  event: ContentEvent;
  blocks: ContentBlock[];
  questions: Pick<RsvpQuestion, 'id' | 'type' | 'required' | 'prompt' | 'options' | 'statementVersionId'>[];
  media: Map<string, ContentMedia>;
  defaultMedia?: Map<BlockType, ContentMedia[]>;
};
type Translate = <T>(content: unknown) => T | null;

/** Live pages and previews use the same locale, theme, media and block hydration. */
export function buildInvitationContent(invitation: InvitationContent, requestedLocale?: string) {
  const { event } = invitation;
  const locale = negotiateLocale(requestedLocale, event.locales, event.defaultLocale);
  const translate: Translate = (content) => resolveTranslation(content, locale, event.defaultLocale);
  return {
    slug: invitation.slug,
    isAcceptingResponses: invitation.status === 'PUBLISHED' && (invitation.expiresAt === null || invitation.expiresAt > new Date()),
    template: invitation.template.key,
    theme: { ...asRecord(invitation.template.defaultTheme), ...asRecord(invitation.theme) },
    allowedFonts: invitation.template.allowedFonts,
    ...resolvedTemplateTheme(invitation.templateVersion, { ...asRecord(invitation.template.defaultTheme), ...asRecord(invitation.theme) }),
    musicUrl: firstMediaUrl(invitation, BlockType.MUSIC),
    coverUrl: firstMediaUrl(invitation, BlockType.HERO),
    locale, availableLocales: event.locales,
    event: {
      type: event.type,
      title: translatedField(event.translations, locale, 'title') ?? event.title,
      hosts: translatedField(event.translations, locale, 'hostsLabel') ?? event.hostsLabel,
      startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone,
      sides: { a: event.sideALabel, b: event.sideBLabel },
    },
    guest: null,
    blocks: invitation.blocks.map((block) => ({
      type: block.type, sortOrder: block.sortOrder, variant: block.variant, settings: block.settings,
      content: translate(block.content) ?? {}, media: mediaFor(block, invitation.media, translate, invitation.defaultMedia),
      data: hydrateBlock(block.type, invitation, translate, locale),
    })),
    rsvpFields: fieldsForPage(invitation.rsvpFields, locale, event.defaultLocale),
    rsvpQuestions: invitation.questions.map((question) => ({
      id: question.id, type: question.type, required: question.required, statementVersionId: question.statementVersionId,
      prompt: translate(question.prompt), options: translate(question.options) ?? [],
    })),
  };
}

function hydrateBlock(type: BlockType, invitation: InvitationContent, translate: Translate, locale: string): unknown {
  const { event } = invitation;
  switch (type) {
    case BlockType.VENUE:
    case BlockType.MAP:
      return event.venues.map((venue) => ({ id: venue.id, role: venue.role,
        name: translatedField(venue.translations, locale, 'name') ?? venue.name,
        address: translatedField(venue.translations, locale, 'address') ?? venue.address,
        latitude: venue.latitude, longitude: venue.longitude, mapUrl: venue.mapUrl, arriveAt: venue.arriveAt,
      }));
    case BlockType.TIMELINE:
      return event.timeline.map((entry) => ({ label: translate(entry.label), occursAt: entry.occursAt, venueId: entry.venueId }));
    case BlockType.COUNTDOWN:
      return { target: event.startsAt, timezone: event.timezone };
    default:
      return null;
  }
}

function mediaFor(block: ContentBlock, media: Map<string, ContentMedia>, translate: Translate, defaults?: Map<BlockType, ContentMedia[]>) {
  const assets = block.assetIds.length ? block.assetIds.flatMap((id) => media.get(id) ?? []) : defaults?.get(block.type) ?? [];
  return assets.map((asset) => ({ id: asset.id, url: asset.url, kind: asset.kind, altText: translate<string>(asset.altText),
    width: asset.width, height: asset.height, variants: asset.variants }));
}
function firstMediaUrl(invitation: InvitationContent, type: BlockType): string | null {
  const block = invitation.blocks.find((candidate) => candidate.type === type);
  const firstId = block?.assetIds.find((id) => invitation.media.has(id));
  if (firstId) return invitation.media.get(firstId)?.url ?? null;
  return defaultMediaUrl(invitation, block, type);
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function defaultMediaUrl(invitation: InvitationContent, block: ContentBlock | undefined, type: BlockType): string | null {
  if (!block || block.assetIds.length) return null;
  return invitation.defaultMedia?.get(type)?.[0]?.url ?? null;
}
