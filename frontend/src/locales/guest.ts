import { loadGroup } from './load';

/**
 * What a guest's own pages need (`bundles/guest.*.ts`): always loaded, as every page's words start
 * from these.
 */
await loadGroup('guest');
