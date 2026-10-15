import type PDFDocument from 'pdfkit';

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Long unbroken names wrap at grapheme boundaries, keeping accents together. */
export function wrapText(document: PDFKit.PDFDocument, value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.normalize('NFC').replace(/\p{Cc}/gu, (character) => ['\n', '\r', '\t'].includes(character) ? character : '').split(/\r?\n/)) {
    lines.push(...wrapParagraph(document, paragraph, width));
  }
  return lines.length ? lines : [''];
}

function wrapParagraph(document: InstanceType<typeof PDFDocument>, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word;
    if (document.widthOfString(candidate) <= width) { line = candidate; continue; }
    if (line) lines.push(line);
    const pieces = splitWord(document, word, width);
    lines.push(...pieces.slice(0, -1));
    line = pieces[pieces.length - 1];
  }
  lines.push(line);
  return lines;
}

function splitWord(document: PDFKit.PDFDocument, word: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const { segment } of segments.segment(word)) {
    if (line && document.widthOfString(line + segment) > width) { lines.push(line); line = ''; }
    line += segment;
  }
  lines.push(line);
  return lines;
}
