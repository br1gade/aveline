/**
 * The media type a file's first bytes declare, or null for anything not on
 * the upload allowlist.
 *
 * An upload's Content-Type is whatever the browser — or an attacker — chose
 * to send; the bytes are the file. Checking them stops HTML or script
 * labelled `image/png` reaching the media domain, and accepts the many labels
 * browsers give one format (`audio/x-m4a`, `audio/mp3`).
 */
export function detectMediaType(bytes: Buffer): string | null {
  return SIGNATURES.find(({ matches }) => matches(bytes))?.type ?? null;
}

const ascii = (bytes: Buffer, start: number, text: string) =>
  bytes.length >= start + text.length && bytes.toString('latin1', start, start + text.length) === text;

const startsWith = (bytes: Buffer, prefix: number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** ISO base media files (AVIF, M4A) name their brand after `ftyp` at byte 4. */
const brandOf = (bytes: Buffer) => (ascii(bytes, 4, 'ftyp') ? bytes.toString('latin1', 8, 12) : null);

const AVIF_BRANDS = new Set(['avif', 'avis']);
const MPEG4_AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'mp41', 'mp42', 'isom', 'iso2', 'dash']);

/** An MPEG audio frame starts with eleven set bits. */
const isMpegFrame = (bytes: Buffer) => bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;

const SIGNATURES: { type: string; matches: (bytes: Buffer) => boolean }[] = [
  { type: 'image/jpeg', matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  { type: 'image/png', matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { type: 'image/webp', matches: (bytes) => ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP') },
  { type: 'image/avif', matches: (bytes) => AVIF_BRANDS.has(brandOf(bytes) ?? '') },
  { type: 'audio/mp4', matches: (bytes) => MPEG4_AUDIO_BRANDS.has(brandOf(bytes) ?? '') },
  { type: 'audio/mpeg', matches: (bytes) => ascii(bytes, 0, 'ID3') || isMpegFrame(bytes) },
];
