import { loadGroup } from './load';

/**
 * The public pages' words (`bundles/public.*.ts`): the events, checkout, the buyer's order, the
 * vendor's brief, Help and privacy.
 */
await loadGroup('public');
