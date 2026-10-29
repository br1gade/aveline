import { expectData, type ApiClient } from '@/api/client';
import type { components } from '@/api/schema';

import type {
  Arrangement,
  QuestionCreate,
  QuestionEdit,
  QuestionOrder,
  RsvpFieldsEdit,
  SectionEdit,
  ThemeEdit,
} from './payload';
import { readDesign, readLibrary, readTemplates } from './read';
import type {
  Design,
  DesignTemplate,
  DesignWire,
  LibraryItem,
  LibraryItemWire,
  Preview,
  TemplateWire,
} from './types';

type Schemas = components['schemas'];

/**
 * The design calls (docs/API.md §6). Reading needs `invitation:read`, which every role on the
 * event holds; every write needs `invitation:design` (a DESIGNER has it, a VIEWER does not). The
 * writes give the page nothing back: it reloads, so it shows what the server stored.
 *
 * The schema types every translated or free-JSON field as an empty object (FR-4), and `variant`
 * as never `null`, though `null` resets it (FR-44): each body is built by `payload.ts` and cast
 * once here, at the call.
 */

/** The editor's own read: drafts, switched-off blocks and every language. Never the guest page. */
export async function getDesign(api: ApiClient, slug: string): Promise<Design> {
  const design = await expectData<DesignWire>(
    api.GET('/api/v1/invitations/{slug}/design', { params: { path: { slug } } }),
  );
  return readDesign(design);
}

/**
 * The schema leaves out the `eventId` path parameter of the two catalogue routes (FR-44), so the
 * generated type refuses it; openapi-fetch fills any named parameter into the path, so it goes
 * through this one cast.
 */
function withEventId<T>(eventId: string, path: T): T {
  return { ...path, eventId };
}

/** Keyed by event, because a plan may later narrow the catalogue. */
export async function listTemplates(api: ApiClient, eventId: string): Promise<DesignTemplate[]> {
  const templates = await expectData<TemplateWire[]>(
    api.GET('/api/v1/events/{eventId}/design-templates', {
      params: { path: withEventId(eventId, undefined as never) },
    }),
  );
  return readTemplates(templates);
}

/** Resets the look and switches off what the new template cannot render; the page warns first. */
export async function chooseTemplate(
  api: ApiClient,
  slug: string,
  templateKey: string,
): Promise<void> {
  await expectData(
    api.POST('/api/v1/invitations/{slug}/template', {
      params: { path: { slug } },
      body: { templateKey },
    }),
  );
}

export async function updateTheme(api: ApiClient, slug: string, body: ThemeEdit): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/invitations/{slug}/theme', { params: { path: { slug } }, body }),
  );
}

/** Which sections exist, and their order: one call for the whole arrangement. */
export async function arrangeSections(
  api: ApiClient,
  slug: string,
  body: Arrangement,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/invitations/{slug}/arrangement', { params: { path: { slug } }, body }),
  );
}

/** What is inside one section; `{ enabled }` alone shows or hides it. */
export async function updateSection(
  api: ApiClient,
  slug: string,
  type: string,
  body: SectionEdit & { enabled?: boolean },
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/invitations/{slug}/blocks/{type}', {
      params: { path: { slug, type } },
      body: body as Schemas['UpdateBlockDto'],
    }),
  );
}

export async function updateRsvpFields(
  api: ApiClient,
  slug: string,
  body: RsvpFieldsEdit,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/invitations/{slug}/rsvp-fields', {
      params: { path: { slug } },
      body: body as unknown as Schemas['UpdateRsvpFieldsDto'],
    }),
  );
}

export async function createQuestion(
  api: ApiClient,
  slug: string,
  body: QuestionCreate,
): Promise<void> {
  await expectData(
    api.POST('/api/v1/invitations/{slug}/questions', {
      params: { path: { slug } },
      body: body as Schemas['UpsertQuestionDto'],
    }),
  );
}

export async function updateQuestion(
  api: ApiClient,
  slug: string,
  questionId: string,
  body: QuestionEdit,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/invitations/{slug}/questions/{questionId}', {
      params: { path: { slug, questionId } },
      body: body as Schemas['UpdateQuestionDto'],
    }),
  );
}

/** Refused with a 400 once any guest has answered it. */
export async function removeQuestion(
  api: ApiClient,
  slug: string,
  questionId: string,
): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/invitations/{slug}/questions/{questionId}', {
      params: { path: { slug, questionId } },
    }),
  );
}

/** A 409 when the questions changed since the page read them. */
export async function reorderQuestions(
  api: ApiClient,
  slug: string,
  body: QuestionOrder,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/invitations/{slug}/question-order', { params: { path: { slug } }, body }),
  );
}

/** The event's uploads, newest first. */
export async function listMedia(api: ApiClient, eventId: string): Promise<LibraryItem[]> {
  const items = await expectData<LibraryItemWire[]>(
    api.GET('/api/v1/events/{eventId}/media', { params: { path: { eventId } } }),
  );
  return readLibrary(items);
}

export type UploadKind = 'PHOTO' | 'COVER' | 'LOGO';

/**
 * Multipart, field `file`, and `kind` for an image; audio is AUDIO by its type. The schema types
 * the file as a string (`format: binary`), so the body is the form data itself, through
 * `bodySerializer`, as the guest import's is.
 */
export async function uploadMedia(
  api: ApiClient,
  eventId: string,
  file: File,
  kind: UploadKind | null,
): Promise<void> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (kind) form.append('kind', kind);
  await expectData(
    api.POST('/api/v1/events/{eventId}/media', {
      params: { path: { eventId } },
      body: {},
      bodySerializer: () => form,
    }),
  );
}

export async function updateAltText(
  api: ApiClient,
  eventId: string,
  assetId: string,
  altText: Record<string, string | null>,
): Promise<void> {
  await expectData(
    api.PATCH('/api/v1/events/{eventId}/media/{assetId}', {
      params: { path: { eventId, assetId } },
      body: { altText } as Schemas['UpdateMediaDto'],
    }),
  );
}

/** Refused with a 409 while a block or the listing shows it. */
export async function removeMedia(api: ApiClient, eventId: string, assetId: string): Promise<void> {
  await expectData(
    api.DELETE('/api/v1/events/{eventId}/media/{assetId}', {
      params: { path: { eventId, assetId } },
    }),
  );
}

/** Only what was asked for: an absent value is left out, never sent empty. */
function queryOf(query: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

/** The invitation's saved design, drafts included, in this or another template. */
export function previewInvitation(
  api: ApiClient,
  slug: string,
  query: { templateKey?: string | undefined; locale?: string | undefined },
): Promise<Preview> {
  return expectData<Preview>(
    api.GET('/api/v1/invitations/{slug}/template-preview', {
      params: { path: { slug }, query: queryOf(query) },
    }),
  );
}

/** A template with synthetic content in four languages; no customer data. */
export function previewTemplate(
  api: ApiClient,
  eventId: string,
  templateKey: string,
  locale: string | undefined,
): Promise<Preview> {
  return expectData<Preview>(
    api.GET('/api/v1/events/{eventId}/design-templates/{templateKey}/preview', {
      params: { path: withEventId(eventId, { templateKey }), query: queryOf({ locale }) },
    }),
  );
}
