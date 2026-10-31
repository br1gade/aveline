/**
 * Released after a while rather than at once: Firefox reads the object URL after the click has
 * returned, so revoking it in the same task can cancel the download.
 */
const RELEASE_AFTER_MS = 30_000;

/**
 * Hands the browser a file the API client fetched, under the name given. The page never links to
 * the file itself (docs/API.md §6, "Exports"): a temporary link to an object URL is clicked and
 * removed at once, and the URL is released shortly after, so nothing keeps the bytes or an address.
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), RELEASE_AFTER_MS);
}
