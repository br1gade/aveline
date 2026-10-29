import type { InvitationStatus } from '@/features/events';
import type { BuiltInField, Invitation, QuestionType } from '@/features/invitation-renderer';

/**
 * What the design calls return (docs/API.md §6, "Loading the invitation into the editor",
 * "Designing the invitation", "Custom RSVP questions", "Uploading a file"). Interim until FR-1:
 * the schema declares no response types, so these are written from the guide and the backend's
 * `draft-reader.service.ts`, `design.service.ts` and `media.service.ts`. Translated values are
 * typed by hand (FR-4). `read.ts` alone reads the `…Wire` types.
 */

/** One text per language code, such as `{ "hy": "…", "en": "…" }`. */
export type Translated = Readonly<Record<string, string>>;

/** A block's copy: one object per language, each with the fields its block reads (R-30). */
export type BlockCopy = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

export interface MediaVariant {
  width: number;
  height: number;
  url: string;
}

/** An upload as a block shows it, or as the library lists it. Its `url` is public, not a credential. */
export interface DesignMedia {
  id: string;
  url: string;
  /** PHOTO, COVER, LOGO or AUDIO; new kinds may arrive. */
  kind: string;
  altText: Translated;
  width: number | null;
  height: number | null;
  /** Smaller copies, made within a minute of upload; empty until then. */
  variants: MediaVariant[];
}

export interface DesignBlock {
  /** A string, not a `BlockType`: a type this release does not know is kept, in its place. */
  type: string;
  enabled: boolean;
  /** `null` is the template's default layout. */
  variant: string | null;
  content: BlockCopy;
  settings: Readonly<Record<string, unknown>>;
  assetIds: readonly string[];
  media: readonly DesignMedia[];
}

export interface Palette {
  name: string;
  /** Unnamed colours: the template's roles are not said (BQ-2). */
  colors: readonly string[];
}

/** The host's choices, or what renders: the template's defaults under them. */
export interface Theme {
  headingFont?: string | undefined;
  bodyFont?: string | undefined;
  palette?: string | undefined;
}

/** The template as the design read gives it: no layouts there (FR-44). */
export interface TemplateSummary {
  key: string;
  name: string;
  allowedFonts: readonly string[];
  palettes: readonly Palette[];
  /** An empty list means the template declares no restriction. */
  supportedBlocks: readonly string[];
}

/** A template from the catalogue, `GET /events/:eventId/design-templates`. */
export interface DesignTemplate extends TemplateSummary {
  /** The layouts each block may take; a block with no entry takes none. */
  blockVariants: Readonly<Record<string, readonly string[]>>;
  defaultTheme: Theme;
}

export interface ChoiceOption {
  /** Lowercase letters, digits and dashes; what guests send and the catering sheets count. */
  key: string;
  label: Translated;
}

/** How one built-in question is asked: at all, and as free text (`options: null`) or choices. */
export interface BuiltInConfig {
  isEnabled: boolean;
  options: readonly ChoiceOption[] | null;
}

export type RsvpFieldsConfig = Readonly<Record<BuiltInField, BuiltInConfig>>;

export interface Question {
  id: string;
  type: QuestionType;
  required: boolean;
  prompt: Translated;
  /** Choices per language; every language lists as many, since an answer is a position. */
  options: Readonly<Record<string, readonly string[]>>;
  /** Live RSVP answers. A removal or a change of shape is refused once there are any. */
  answerCount: number;
}

export interface DesignEvent {
  id: string;
  title: string;
  /** The languages the event publishes, in its order. */
  locales: readonly string[];
  defaultLocale: string;
  timezone: string;
}

/** `GET /invitations/:slug/design`: the invitation as the host edits it, every language kept. */
export interface Design {
  slug: string;
  status: InvitationStatus;
  isExpired: boolean;
  event: DesignEvent;
  template: TemplateSummary;
  theme: Theme;
  effectiveTheme: Theme;
  rsvpFields: RsvpFieldsConfig;
  /** In page order, switched-off blocks included. Never sorted. */
  blocks: readonly DesignBlock[];
  /** In the host's order. */
  questions: readonly Question[];
  /** English sentences (FR-32), read by the sending feature's `readBlockers`. */
  publishBlockers: readonly string[];
}

/** An upload in the event's library, newest first. */
export interface LibraryItem extends DesignMedia {
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  /** The block types showing it. */
  usedBy: readonly string[];
  /** `HERO` and `SHARE` when the public listing uses it. */
  listingUses: readonly string[];
}

// The wire shapes, as the backend sends them.

export interface MediaWire {
  id: string;
  url: string;
  kind: string;
  altText: unknown;
  width?: number | null;
  height?: number | null;
  variants?: unknown;
}

export interface BlockWire {
  type: string;
  enabled: boolean;
  variant: string | null;
  content: unknown;
  settings: unknown;
  assetIds: string[];
  media?: MediaWire[];
}

export interface TemplateWire {
  key: string;
  name: string;
  allowedFonts: string[];
  palettes: unknown;
  supportedBlocks: string[];
  blockVariants?: unknown;
  defaultTheme?: unknown;
}

export interface QuestionWire {
  id: string;
  type: string;
  required: boolean;
  prompt: unknown;
  options: unknown;
  answerCount?: number;
}

export interface DesignWire {
  slug: string;
  status: string;
  isExpired?: boolean;
  event: {
    id: string;
    title: string;
    locales: string[];
    defaultLocale: string;
    timezone: string;
  };
  template: TemplateWire;
  theme: unknown;
  effectiveTheme: unknown;
  rsvpFields?: unknown;
  blocks: BlockWire[];
  questions: QuestionWire[];
  publishBlockers: string[];
}

export interface LibraryItemWire extends MediaWire {
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  usedBy?: string[];
  listingUses?: string[];
}

/**
 * A preview: the live page's shape, built by the backend's own serializer, with `guest: null` and
 * `isAcceptingResponses: false` (docs/API.md §6, "Previewing a template"). The renderer reads it
 * as it reads a guest's page.
 */
export interface Preview extends Invitation {
  previewSource?: 'SYNTHETIC' | 'EVENT';
}
