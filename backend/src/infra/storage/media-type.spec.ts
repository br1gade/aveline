import { detectMediaType } from './media-type';

const bytes = (...parts: (string | number[])[]) =>
  Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part))));

describe('detectMediaType', () => {
  it.each([
    ['image/jpeg', bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF')],
    ['image/png', bytes([0x89], 'PNG\r\n\x1a\n', 'IHDR')],
    ['image/webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ')],
    ['image/avif', bytes([0, 0, 0, 0x1c], 'ftypavif')],
    ['audio/mpeg', bytes('ID3', [4, 0])],
    ['audio/mpeg', bytes([0xff, 0xfb, 0x90, 0x64])],
    // What browsers label audio/x-m4a; the bytes say MPEG-4 audio either way.
    ['audio/mp4', bytes([0, 0, 0, 0x20], 'ftypM4A ')],
    ['audio/mp4', bytes([0, 0, 0, 0x20], 'ftypisom')],
  ])('reads %s from its first bytes', (type, content) => {
    expect(detectMediaType(content)).toBe(type);
  });

  it.each([
    ['an SVG with script', bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')],
    ['HTML', bytes('<!doctype html><script>alert(1)</script>')],
    ['text', bytes('png')],
    ['nothing', bytes()],
    ['a truncated PNG signature', bytes([0x89], 'PN')],
    ['a WAV file, which is RIFF too', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt ')],
    ['a QuickTime movie', bytes([0, 0, 0, 0x20], 'ftypqt  ')],
    ['a HEIC photo', bytes([0, 0, 0, 0x20], 'ftypheic')],
  ])('recognises nothing in %s', (_, content) => {
    expect(detectMediaType(content)).toBeNull();
  });
});
