/**
 * Photos from guests (docs/API.md §11; design PD-63, PD-65). The guest's side goes on the personal
 * page through the renderer's `renderContributions`; the hosts moderate on their own page.
 */
export type { GalleryLink } from './api';
export { GuestGallery } from './components/guest-gallery';
export { GalleryModeration } from './components/moderation-page';
export { loadModeration, type ModerationData } from './load';
