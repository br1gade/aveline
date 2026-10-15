// Synthetic, database-free acceptance fixture. Never load customer data here.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderExport } = require(`${root}/dist/modules/exports/renderers/render-export.js`);
const destination = resolve(process.argv[2] ?? '/tmp/aveline-render-rehearsal');
const samples = ['Անահիտ Հովհաննիսյան', 'Александра Иванова', 'Émilie Dufour', 'William O’Connor'];
const locales = ['en', 'ru', 'fr', 'hy'];
const kinds = ['GUEST_LIST', 'SEATING_CHART', 'PLACE_CARDS', 'CATERING_SHEET', 'BAR_SHEET', 'PLAYLIST', 'TICKET_MANIFEST'];
const people = Array.from({ length: 400 }, (_, index) => ({
  name: `${samples[index % 4]} ${String(index + 1).padStart(3, '0')}`,
  venue: index % 2 === 0 ? 'Երևան - Salle des fêtes' : 'Москва - Garden hall',
  table: `Table ${Math.floor(index / 20) + 1}`, index,
}));
people[0].name = 'Ա'.repeat(98) + ' Иванова Émilie 001';
people[1].name = '=HYPERLINK("https://invalid.test","literal text") 002';
const question = { en: 'Meal preference', ru: 'Предпочтения в еде', fr: 'Préférence de repas', hy: 'Սննդի նախընտրություն' };

function sheetFor(kind, locale) {
  const questionColumn = `Q1: ${question[locale]}`;
  const sheets = {
    GUEST_LIST: () => ({ columns: ['Household', 'First name', 'Last name', 'Email', 'Phone', 'Side', 'Seats allotted', 'RSVP', 'Dietary', 'Dietary notes', 'Table', 'Seating by venue', 'Arrived', questionColumn],
      rows: people.map((p) => ({ Household: `Household ${Math.floor(p.index / 4) + 1}`, 'First name': p.name, 'Last name': 'Dufour Հովհաննիսյան', Email: `guest${p.index}@example.test`, Phone: '+37410000000', Side: 'SIDE_A',
        'Seats allotted': 4, RSVP: 'ATTENDING', Dietary: 'Vegetarian', 'Dietary notes': p.index % 10 === 0 ? 'Allergy: nuts. Русский Հայերեն français. '.repeat(8) : '',
        Table: p.table, 'Seating by venue': `${p.venue}: ${p.table}`, Arrived: '2026-10-15T12:34:56.000Z', [questionColumn]: p.index % 2 ? 'cafe\u0301 - без орехов - առանց ընկույզի' : 'Vegetarian' })) }),
    SEATING_CHART: () => ({ columns: ['Venue', 'Arrangement', 'Table', 'Capacity', 'Seated', 'Guest'], rows: people.map((p) => ({ Venue: p.venue, Arrangement: `arrangement-${p.index % 2}`, Table: p.table, Capacity: 12, Seated: 10, Guest: p.name })) }),
    PLACE_CARDS: () => ({ columns: ['Name', 'Venue', 'Arrangement', 'Table'], rows: people.map((p) => ({ Name: p.name, Venue: p.venue, Arrangement: `arrangement-${p.index % 2}`, Table: p.table })) }),
    CATERING_SHEET: () => ({ columns: ['Venue', 'Requirement', 'Guests', 'Note'], rows: [{ Venue: people[0].venue, Requirement: 'Total covers', Guests: 200 }, { Venue: people[1].venue, Requirement: 'Total covers', Guests: 200 }, { Venue: people[0].venue, Requirement: 'Vegetarian', Guests: 60 }, { Venue: people[1].venue, Requirement: 'Vegetarian', Guests: 60 },
      ...people.map((p) => ({ Venue: p.venue, Requirement: 'Dietary note', Guests: p.name, Note: 'No nuts / без орехов / առանց ընկույզի. Café. '.repeat(3) }))] }),
    BAR_SHEET: () => ({ columns: ['Venue', 'Drink', 'Guests', 'Share %'], rows: [{ Venue: people[0].venue, Drink: 'Red wine / красное / գինի', Guests: 200, 'Share %': 100 }, { Venue: people[1].venue, Drink: 'Water / eau / ջուր', Guests: 200, 'Share %': 100 }] }),
    PLAYLIST: () => ({ columns: ['Track', 'Requests'], rows: people.map((p) => ({ Track: `${p.name} - Café de Paris`, Requests: p.index + 1 })) }),
    TICKET_MANIFEST: () => ({ columns: ['Code', 'Type', 'Holder', 'Buyer', 'Buyer email', 'Status', 'Used at'], rows: people.map((p) => ({ Code: `00${p.index}`, Type: 'General admission', Holder: p.name, Buyer: 'Émilie Աննա', 'Buyer email': 'buyer@example.test', Status: 'VALID', 'Used at': '2026-10-15T12:34:56.000Z' })) }),
  };
  return sheets[kind]();
}

await mkdir(destination, { recursive: true });
const results = [];
for (const locale of locales) {
  for (const kind of kinds) {
    const sheet = sheetFor(kind, locale);
    for (const format of ['CSV', 'PDF', 'XLSX']) {
      const start = performance.now();
      const file = await renderExport({ title: 'Աննա & Иван - Événement', snapshotAt: new Date('2026-10-15T12:34:56Z'), timezone: 'Asia/Yerevan', locale,
        attendanceRevision: 2, dataRevision: 'fixture:400', includesContacts: true, kind, format, sheet });
      const name = `${locale}-${kind.toLowerCase()}.${file.extension}`;
      await writeFile(resolve(destination, name), file.buffer);
      results.push({ name, rows: sheet.rows.length, bytes: file.buffer.length, milliseconds: Math.round(performance.now() - start), rssBytes: process.memoryUsage().rss });
    }
  }
}
await writeFile(resolve(destination, 'people.json'), JSON.stringify(people));
await writeFile(resolve(destination, 'results.json'), JSON.stringify(results, null, 2));
console.log(`Wrote ${results.length} synthetic files to ${destination}`);
