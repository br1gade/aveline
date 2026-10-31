import { BlockType, PrismaClient } from '@prisma/client';
import { inflateSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import type { Response } from 'superagent';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';

/**
 * Platform data a fresh deployment gets from `seed-production`: the classic
 * template a host picks from and Aveline's own message copy. A customer
 * cannot create either, so a journey that starts from registration needs them.
 */
export async function seedPlatformDefaults(prisma: PrismaClient): Promise<void> {
  await prisma.designTemplate.upsert({
    where: { key: 'classic' },
    update: {},
    create: {
      key: 'classic',
      name: 'Classic',
      allowedFonts: ['Noto Serif Armenian', 'Inter'],
      palettes: [{ name: 'ivory-gold', colors: ['#fffaf0', '#b8860b'] }],
      supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.NOTES, BlockType.RSVP],
      blockVariants: { HERO: ['full-bleed', 'split'], RSVP: ['split', 'stacked'] },
      defaultTheme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' },
    },
  });
  await prisma.messageTemplate.createMany({
    data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })),
  });
}

/**
 * Reads an exported CSV the way a spreadsheet would: BOM stripped, CRLF rows,
 * every cell quoted with doubled quotes inside. One record per data row,
 * keyed by the header.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter((line) => line.length > 0);
  const [header, ...rows] = lines.map(parseCsvLine);
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])));
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  const pattern = /"((?:[^"]|"")*)"|([^,]*)/g;
  let position = 0;
  while (position <= line.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(line)!;
    cells.push(match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2]);
    position = pattern.lastIndex + 1;
  }
  return cells;
}

/** Every XML part of a workbook, joined: enough to find the text a cell holds. */
export function workbookXml(buffer: Buffer): string {
  return Object.entries(unzipSync(buffer))
    .filter(([name]) => name.endsWith('.xml'))
    .map(([, value]) => strFromU8(value))
    .join('\n');
}

/** The personal link a sent message carries, as `{ slug, token }`. */
export function linkIn(body: string): { slug: string; token: string } {
  const match = /\/invitations\/([^/\s]+)\/g\/([^/\s]+)/.exec(body);
  if (!match) throw new Error(`No personal link in message: ${body}`);
  return { slug: match[1], token: match[2] };
}

/** Collects a binary response body into one Buffer, whatever its MIME type. */
export function binaryParser(response: Response, done: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => done(error, Buffer.alloc(0)));
}

interface PdfObject { dictionary: string; stream?: Buffer }

/**
 * The text a PDF shows, page by page, one entry per text run. pdfkit writes
 * glyph IDs of subset fonts into deflated content streams; each font carries a
 * ToUnicode map, which is what a reader's copy-and-paste uses, and so is used
 * here. Enough for pdfkit's own output, not a general PDF parser.
 */
export function pdfText(buffer: Buffer): string[][] {
  const objects = pdfObjects(buffer);
  const ref = (dictionary: string, key: string) => /(\d+) 0 R/.exec(dictionary.split(`/${key} `)[1] ?? '')?.[1];
  const catalog = [...objects.values()].find((object) => /\/Type \/Catalog\b/.test(object.dictionary))!;
  const pages = objects.get(ref(catalog.dictionary, 'Pages')!)!;
  const kids = [...(/\/Kids \[([^\]]*)\]/.exec(pages.dictionary)?.[1] ?? '').matchAll(/(\d+) 0 R/g)].map((match) => match[1]);
  return kids.map((kid) => {
    const page = objects.get(kid)!;
    const fonts = new Map([...(/\/Font <<([\s\S]*?)>>/.exec(resourcesOf(page.dictionary, objects))?.[1] ?? '').matchAll(/\/(\w+) (\d+) 0 R/g)]
      .map(([, name, fontRef]) => [name, toUnicode(objects.get(ref(objects.get(fontRef)!.dictionary, 'ToUnicode')!)!.stream!.toString('latin1'))]));
    return textRuns(objects.get(ref(page.dictionary, 'Contents')!)!.stream!.toString('latin1'), fonts);
  });
}

function pdfObjects(buffer: Buffer): Map<string, PdfObject> {
  const source = buffer.toString('latin1');
  const objects = new Map<string, PdfObject>();
  const header = /(\d+) 0 obj\b/g;
  for (let match = header.exec(source); match; match = header.exec(source)) {
    const end = source.indexOf('endobj', header.lastIndex);
    const streamAt = source.indexOf('stream', header.lastIndex);
    if (streamAt === -1 || streamAt > end) { objects.set(match[1], { dictionary: source.slice(header.lastIndex, end) }); continue; }
    const dictionary = source.slice(header.lastIndex, streamAt);
    const start = streamAt + /^stream\r?\n/.exec(source.slice(streamAt, streamAt + 8))![0].length;
    const raw = buffer.subarray(start, start + Number(/\/Length (\d+)/.exec(dictionary)![1]));
    objects.set(match[1], { dictionary, stream: /\/FlateDecode/.test(dictionary) ? inflateSync(raw) : raw });
    header.lastIndex = start + raw.length;
  }
  return objects;
}

function resourcesOf(dictionary: string, objects: Map<string, PdfObject>): string {
  const indirect = /\/Resources (\d+) 0 R/.exec(dictionary);
  return indirect ? objects.get(indirect[1])!.dictionary : dictionary;
}

/** Glyph ID (4 hex digits) to the text it stands for, from a ToUnicode CMap. */
function toUnicode(cmap: string): Map<string, string> {
  const glyphs = new Map<string, string>();
  const utf16 = (hex: string) => Buffer.from(hex, 'hex').swap16().toString('utf16le');
  for (const [, from, , list] of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]{4})>\s*\[([^\]]*)\]/gi)) {
    [...list.matchAll(/<([0-9a-f]+)>/gi)].forEach(([, hex], index) =>
      glyphs.set((parseInt(from, 16) + index).toString(16).padStart(4, '0'), utf16(hex)));
  }
  for (const [, glyph, hex] of cmap.matchAll(/<([0-9a-f]{4})>\s*<([0-9a-f]+)>\s*$/gim)) glyphs.set(glyph.toLowerCase(), utf16(hex));
  return glyphs;
}

function textRuns(content: string, fonts: Map<string, Map<string, string>>): string[] {
  const runs: string[] = [];
  let glyphs = new Map<string, string>();
  for (const [, font, array] of content.matchAll(/\/(\w+) [\d.]+ Tf|\[([^\]]*)\] TJ/g)) {
    if (font) { glyphs = fonts.get(font) ?? new Map(); continue; }
    const hex = [...array.matchAll(/<([0-9a-f]*)>/gi)].map((match) => match[1]).join('');
    runs.push((hex.match(/.{4}/g) ?? []).map((glyph) => glyphs.get(glyph.toLowerCase()) ?? '�').join(''));
  }
  return runs;
}
