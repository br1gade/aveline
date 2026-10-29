import { generatePath } from 'react-router';

import { APP_PATHS } from '@/route-paths';

export function designPath(eventId: string): string {
  return generatePath(APP_PATHS.design, { eventId });
}

export function designLookPath(eventId: string): string {
  return generatePath(APP_PATHS.designLook, { eventId });
}

export function designSectionPath(eventId: string, blockType: string): string {
  return generatePath(APP_PATHS.designSection, { eventId, blockType });
}

export function designQuestionsPath(eventId: string): string {
  return generatePath(APP_PATHS.designQuestions, { eventId });
}

export function newDesignQuestionPath(eventId: string): string {
  return generatePath(APP_PATHS.newDesignQuestion, { eventId });
}

export function editDesignQuestionPath(eventId: string, questionId: string): string {
  return generatePath(APP_PATHS.editDesignQuestion, { eventId, questionId });
}

export function designMediaPath(eventId: string): string {
  return generatePath(APP_PATHS.designMedia, { eventId });
}

export interface PreviewQuery {
  templateKey?: string | undefined;
  isSample?: boolean;
  locale?: string | undefined;
}

/** `?template=`, `?sample=1` and `?locale=`, as `previewRequestOf` reads them. */
export function designPreviewPath(eventId: string, query: PreviewQuery = {}): string {
  const search = new URLSearchParams();
  if (query.templateKey) search.set('template', query.templateKey);
  if (query.isSample) search.set('sample', '1');
  if (query.locale) search.set('locale', query.locale);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return `${generatePath(APP_PATHS.designPreview, { eventId })}${suffix}`;
}

/** The venues page, where an address is typed once for every section that shows it. */
export function venuesPath(eventId: string): string {
  return generatePath(APP_PATHS.venues, { eventId });
}
