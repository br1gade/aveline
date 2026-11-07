/**
 * A guest corrects their own name from their personal link (docs/API.md §4; design PD-64). The
 * guest page puts the form into the personal card through the renderer's `renderPersonal`.
 */
export type { NameLink } from './api';
export { NameCorrection, type NameCorrectionProps } from './components/name-correction';
export { withCorrectedName } from './correction';
export type { CorrectedName, SavedName } from './types';
