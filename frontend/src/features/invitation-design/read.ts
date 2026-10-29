import type { InvitationStatus } from '@/features/events';
import { BUILT_IN_FIELDS, type QuestionType } from '@/features/invitation-renderer';

import type {
  BlockCopy,
  BlockWire,
  BuiltInConfig,
  ChoiceOption,
  Design,
  DesignBlock,
  DesignMedia,
  DesignTemplate,
  DesignWire,
  LibraryItem,
  LibraryItemWire,
  MediaVariant,
  MediaWire,
  Palette,
  Question,
  QuestionWire,
  RsvpFieldsConfig,
  TemplateSummary,
  TemplateWire,
  Theme,
  Translated,
} from './types';

/**
 * Where design data arrives. Objects are built by naming their fields, never by spreading the
 * response, so anything the backend adds later stops here. The translated and free-JSON values
 * are read leniently: a malformed entry is dropped, never an error, as the renderer reads them.
 */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectOf(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Each language's text; anything that is not text is left out. */
function readTranslated(value: unknown): Translated {
  return Object.fromEntries(
    Object.entries(objectOf(value)).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );
}

/** Each language's copy object, kept whole, unknown fields included, so a save can keep them. */
function readCopy(value: unknown): BlockCopy {
  return Object.fromEntries(
    Object.entries(objectOf(value)).filter((entry): entry is [string, JsonObject] =>
      isObject(entry[1]),
    ),
  );
}

function readVariants(value: unknown): MediaVariant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const { width, height, url } = objectOf(entry);
    const isVariant =
      typeof width === 'number' && typeof height === 'number' && typeof url === 'string';
    return isVariant ? [{ width, height, url }] : [];
  });
}

function readMedia(media: MediaWire): DesignMedia {
  return {
    id: media.id,
    url: media.url,
    kind: media.kind,
    altText: readTranslated(media.altText),
    width: media.width ?? null,
    height: media.height ?? null,
    variants: readVariants(media.variants),
  };
}

function readBlock(block: BlockWire): DesignBlock {
  return {
    type: block.type,
    enabled: block.enabled,
    variant: block.variant,
    content: readCopy(block.content),
    settings: objectOf(block.settings),
    assetIds: [...block.assetIds],
    media: (block.media ?? []).map(readMedia),
  };
}

function readPalettes(value: unknown): Palette[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const { name, colors } = objectOf(entry);
    return typeof name === 'string' ? [{ name, colors: stringsOf(colors) }] : [];
  });
}

function readTheme(value: unknown): Theme {
  const { headingFont, bodyFont, palette } = objectOf(value);
  return {
    ...(typeof headingFont === 'string' ? { headingFont } : {}),
    ...(typeof bodyFont === 'string' ? { bodyFont } : {}),
    ...(typeof palette === 'string' ? { palette } : {}),
  };
}

function readSummary(template: TemplateWire): TemplateSummary {
  return {
    key: template.key,
    name: template.name,
    allowedFonts: stringsOf(template.allowedFonts),
    palettes: readPalettes(template.palettes),
    supportedBlocks: stringsOf(template.supportedBlocks),
  };
}

/** The catalogue in the API's order, which is by name. */
export function readTemplates(templates: readonly TemplateWire[]): DesignTemplate[] {
  return templates.map((template) => ({
    ...readSummary(template),
    blockVariants: Object.fromEntries(
      Object.entries(objectOf(template.blockVariants)).map(([type, offered]) => [
        type,
        stringsOf(offered),
      ]),
    ),
    defaultTheme: readTheme(template.defaultTheme),
  }));
}

function readOption(value: unknown): ChoiceOption[] {
  const { key, label } = objectOf(value);
  return typeof key === 'string' ? [{ key, label: readTranslated(label) }] : [];
}

/** Each built-in question; one the backend did not mention is asked, as free text, as it says. */
export function readRsvpFields(value: unknown): RsvpFieldsConfig {
  const stored = objectOf(value);
  const entries = BUILT_IN_FIELDS.map((field): [string, BuiltInConfig] => {
    const { isEnabled, options } = objectOf(stored[field]);
    return [
      field,
      {
        isEnabled: typeof isEnabled === 'boolean' ? isEnabled : true,
        options: Array.isArray(options) ? options.flatMap(readOption) : null,
      },
    ];
  });
  return Object.fromEntries(entries) as RsvpFieldsConfig;
}

const QUESTION_TYPES: readonly QuestionType[] = [
  'TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'BOOLEAN',
  'SIGNATURE',
];

function questionTypeOf(type: string): QuestionType {
  // The backend's enum has these six; a seventh would need a release to edit, so it reads as text
  // here, and a save never sends a type it did not change.
  return QUESTION_TYPES.find((known) => known === type) ?? 'TEXT';
}

function readOptions(value: unknown): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(objectOf(value)).map(([locale, list]) => [locale, stringsOf(list)]),
  );
}

function readQuestion(question: QuestionWire): Question {
  return {
    id: question.id,
    type: questionTypeOf(question.type),
    required: question.required,
    prompt: readTranslated(question.prompt),
    options: readOptions(question.options),
    answerCount: question.answerCount ?? 0,
  };
}

function statusOf(status: string): InvitationStatus {
  return status === 'PUBLISHED' || status === 'CLOSED' ? status : 'DRAFT';
}

export function readDesign(design: DesignWire): Design {
  return {
    slug: design.slug,
    status: statusOf(design.status),
    isExpired: design.isExpired ?? false,
    event: {
      id: design.event.id,
      title: design.event.title,
      locales: stringsOf(design.event.locales),
      defaultLocale: design.event.defaultLocale,
      timezone: design.event.timezone,
    },
    template: readSummary(design.template),
    theme: readTheme(design.theme),
    effectiveTheme: readTheme(design.effectiveTheme),
    rsvpFields: readRsvpFields(design.rsvpFields),
    // In page order, as given. Never sorted.
    blocks: design.blocks.map(readBlock),
    questions: design.questions.map(readQuestion),
    publishBlockers: stringsOf(design.publishBlockers),
  };
}

/** Newest first, as the API gives it. */
export function readLibrary(items: readonly LibraryItemWire[]): LibraryItem[] {
  return items.map((item) => ({
    ...readMedia(item),
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    usedBy: stringsOf(item.usedBy),
    listingUses: stringsOf(item.listingUses),
  }));
}
