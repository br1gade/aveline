import type { ApiClient } from '@/api/client';
import { loaded, type Loaded } from '@/api/loaded';
import { getEvent, type EventDetail } from '@/features/events';

import { getDesign, listMedia, listTemplates, previewInvitation, previewTemplate } from './api';
import type { Design, DesignTemplate, LibraryItem, Preview, Question } from './types';

/**
 * Every design page reads the event, for its invitation's link name, and then the invitation's
 * design: the editor's own read, never the guest page (docs/API.md §6). An event with no
 * invitation has nothing to design, and the page says so. The parts a page can do without load
 * on their own (`Loaded`), so a refused or failed one leaves the page standing.
 */
export interface DesignData {
  event: EventDetail;
  /** `null` when the event has no invitation. */
  design: Design | null;
}

async function loadDesign(api: ApiClient, eventId: string): Promise<DesignData> {
  const event = await getEvent(api, eventId);
  const design = event.invitation ? await getDesign(api, event.invitation.slug) : null;
  return { event, design };
}

export function loadDesignOverview(api: ApiClient, eventId: string): Promise<DesignData> {
  return loadDesign(api, eventId);
}

export interface DesignLookData extends DesignData {
  templates: Loaded<DesignTemplate[]>;
}

export async function loadDesignLook(api: ApiClient, eventId: string): Promise<DesignLookData> {
  const [data, templates] = await Promise.all([
    loadDesign(api, eventId),
    loaded(listTemplates(api, eventId)),
  ]);
  return { ...data, templates };
}

export interface DesignSectionData extends DesignLookData {
  type: string;
  library: Loaded<LibraryItem[]>;
}

/** The catalogue for the section's layouts (FR-44), and the library to choose its media from. */
export async function loadDesignSection(
  api: ApiClient,
  eventId: string,
  type: string,
): Promise<DesignSectionData> {
  const [data, templates, library] = await Promise.all([
    loadDesign(api, eventId),
    loaded(listTemplates(api, eventId)),
    loaded(listMedia(api, eventId)),
  ]);
  return { ...data, type, templates, library };
}

export function loadDesignQuestions(api: ApiClient, eventId: string): Promise<DesignData> {
  return loadDesign(api, eventId);
}

export interface DesignQuestionData extends DesignData {
  /** `null` when it is no longer on the invitation, which the page says rather than failing. */
  question: Question | null;
}

/** There is no single-question read; the design holds every question. */
export async function loadDesignQuestion(
  api: ApiClient,
  eventId: string,
  questionId: string,
): Promise<DesignQuestionData> {
  const data = await loadDesign(api, eventId);
  const question = data.design?.questions.find((candidate) => candidate.id === questionId);
  return { ...data, question: question ?? null };
}

export interface DesignMediaData extends DesignData {
  library: Loaded<LibraryItem[]>;
}

export async function loadDesignMedia(api: ApiClient, eventId: string): Promise<DesignMediaData> {
  const [data, library] = await Promise.all([
    loadDesign(api, eventId),
    loaded(listMedia(api, eventId)),
  ]);
  return { ...data, library };
}

export interface PreviewRequest {
  /** Another template than the invitation's; none for its own. */
  templateKey: string | undefined;
  /** The template's synthetic content rather than the invitation's. */
  isSample: boolean;
  locale: string | undefined;
}

export interface DesignPreviewData extends DesignData {
  request: PreviewRequest;
  /** `null` when there is nothing to preview: no invitation, and no sample asked for. */
  preview: Preview | null;
  templates: Loaded<DesignTemplate[]>;
}

/** The sample needs a template; without one asked for, the invitation's own is shown. */
function previewOf(
  api: ApiClient,
  data: DesignData,
  request: PreviewRequest,
): Promise<Preview> | null {
  if (request.isSample) {
    const key = request.templateKey ?? data.design?.template.key;
    return key ? previewTemplate(api, data.event.id, key, request.locale) : null;
  }
  return data.design
    ? previewInvitation(api, data.design.slug, {
        templateKey: request.templateKey,
        locale: request.locale,
      })
    : null;
}

export async function loadDesignPreview(
  api: ApiClient,
  eventId: string,
  request: PreviewRequest,
): Promise<DesignPreviewData> {
  const [data, templates] = await Promise.all([
    loadDesign(api, eventId),
    loaded(listTemplates(api, eventId)),
  ]);
  const preview = await previewOf(api, data, request);
  return { ...data, request, preview, templates };
}

/** `?template=`, `?sample=1` and `?locale=`, as the preview's links write them. */
export function previewRequestOf(url: URL): PreviewRequest {
  const templateKey = url.searchParams.get('template') || undefined;
  const locale = url.searchParams.get('locale') || undefined;
  return { templateKey, isSample: url.searchParams.get('sample') === '1', locale };
}
