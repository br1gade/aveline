/**
 * A link a page may open from host content: http or https only, so a stored `javascript:` URL
 * never runs. The guest page applies it to every link a host typed, and the venue form refuses
 * what it would drop, so a host learns at once that guests would get no link.
 */
export function safeExternalUrl(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
