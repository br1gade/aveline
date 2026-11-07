import { appMeta } from '@/features/account';
import { DraftPreviewFrame } from '@/features/invitation-design';
import { languageOfMatches } from '@/lib/i18n';

import type { Route } from './+types/design-draft-preview';

/**
 * A section's unsaved edits, drawn inside its page's frame (design PD-153). The only page the app
 * frames, and only itself (`entry.server.tsx`); it reads nothing but what that page sends it.
 */
export function meta({ matches }: Route.MetaArgs) {
  return appMeta('designDraftPreview', languageOfMatches(matches));
}

export default function DesignDraftPreview({ params }: Route.ComponentProps) {
  return <DraftPreviewFrame eventId={params.eventId} />;
}
