# Snapshot export renderers

Implemented 16 October 2026. All seven kinds support CSV, PDF and XLSX through
`/export-snapshots`. Legacy `/exports` routes remain live CSV for frontend
compatibility. See [API.md](../../docs/API.md) for requests/permissions and
[EXPORT_WORKER.md](EXPORT_WORKER.md) for private storage, retries and cleanup.

## Library and font decision

The bounded compatibility spike selected these pinned dependencies:

| Dependency | License | Reason and verification |
|---|---|---|
| [PDFKit 0.20.2](https://github.com/foliojs/pdfkit/releases) | MIT | Active release line; explicit text metrics, embedded TrueType subsets and page geometry without a browser process. Custom pagination avoids implicit cell clipping. |
| [write-excel-file 4.1.1](https://github.com/catamphetamine/write-excel-file) | MIT | Small Node writer with explicit String/Number/Date cells, styled sheets and frozen headers; no formula evaluation or user workbook imports needed. |
| [DejaVu Sans 2.37](https://dejavu-fonts.github.io/) regular/bold | Bitstream Vera grant; DejaVu changes public domain | Bundled unmodified fonts and complete notice under `assets/fonts`; no network/system font dependency in PDF generation. |

The production image copies fonts and their notice. PDF embeds subsets; XLSX
requests DejaVu Sans and relies on the viewer's font fallback (fonts are not
embedded in workbooks). Glyph checks include Armenian, Cyrillic, Latin, French
accents, Armenian ligatures and combining accents. PDF text is normalized to
NFC and wraps at grapheme boundaries, including long unbroken names.

The workbook writer explicitly types guest content as String, never as formulas
or hyperlinks. Counts use Number; percentages use Excel fractions and a percent
format. Recognized attendance timestamps and generation time use Date, labelled
UTC. Codes and phone numbers remain strings. CSV protection is unchanged.
These renderers do not parse user-provided PDFs or workbooks.

Dependency review patched the new direct test dependency on fflate to 0.8.3. Existing
repository dependency advisories remain separate work; this batch does not force
unrelated toolchain upgrades. Recheck advisories when updating these pins.

## Layouts and limits

- Guest lists, playlists and manifests use paginated tables. Wide tables split
  into groups of at most six columns, repeating identifying columns. Full
  question prompts appear above shortened column headers. Long rows continue
  onto new pages with repeated headings and identifying fields.
- Seating PDFs group rosters by venue, arrangement and table, showing capacity
  and seated counts. Geometric floor-plan pages are outside this release.
- Place cards are six **90 × 70 mm flat cut cards per A4**, with dashed cut
  guides. Names wrap and shrink from 20 to 12 pt; content that cannot fit fails
  the job instead of silently clipping.
- Snapshot catering/bar sheets use each guest-facing venue's active attendance
  policy/revision. Preparation and internal-only venues are excluded; event-wide
  attendees count at every guest-facing venue. With no such venues, the legacy
  event-wide layout applies. Catering workbooks separate requirements and notes.
- Documents identify the event, generation time, timezone and contact
  visibility. Snapshot metadata retains locale, attendance revision and the
  Postgres visibility token, which is provenance rather than a monotonic version.

One worker processes one job at a time, outside the API process and capture
transaction. Capture limits: 5,000 each of guests, seats, tickets, orders,
attendees and tables; 50 venues; 200 custom questions; 100,000 answers.
Rendered sheets allow 20,000 rows, 256 columns, 32,767 characters per cell and
2 million source text characters. Output is capped at 10 MiB. PDF checks a
500-page/45-second limit when adding pages. The worker has a 384 MiB JS heap
and a 512 MiB container memory limit. Bounds are safety caps, not a guarantee
that every maximum-sized combination fits; exceeded resources/limits produce
bounded retries and a safe failure code.

## Repeatable 400-person file acceptance

```sh
npm run build
node --max-old-space-size=384 scripts/export-render-rehearsal.mjs
```

The script uses synthetic data only and writes to `/tmp/aveline-render-rehearsal`
(or its first argument). It creates **84 files**: 7 kinds × 3 formats × 4 locales,
plus metrics and the fixture roster. No database, network, credentials or customer
data are needed. Standard headings now support all four pilot languages; requested locales
select translated question labels and format PDF generation dates. The fixture
includes all four scripts, two venues, a long unbroken Armenian name, combining
accents, formula-like text, leading-zero ticket codes and attendance timestamps.

Local measurements under a 384 MiB JS heap: maximum per-file rendering time
**457 ms PDF / 111 ms XLSX / 7 ms CSV**, peak process RSS **253.3 MiB**, largest
file **224,910 bytes**. These describe one synthetic local rehearsal, not
production capacity or a worst-case memory guarantee.

Acceptance performed for this batch:

- Parsed all 28 PDFs with pypdf/pdfplumber: complete attendee names, page text,
  provenance and glyph bounds within pages. Checked all 400 card rectangles
  and text bounds in each of the four place-card PDFs.
- Rasterized first/middle/last pages with Poppler and visually inspected all
  kinds/locales, including long names, repeated headings and final card pages.
- Opened all 28 XLSX files with openpyxl and the bundled spreadsheet QA tool;
  rendered worksheet previews, including both catering tabs. Checked literal
  strings, no formulas/hyperlinks/external links, typed UTC dates, percentages,
  leading-zero codes and frozen headers. These value-only workbooks need no
  formula recalculation.
- Unit tests cover renderer bounds, embedded fonts, pagination and cell safety.
  Real-database tests cover the full kind/format snapshot matrix, immutable
  downloads, format-aware idempotency and venue attendance totals. HTTP tests
  cover MIME/filenames, queue states and current authorization.

Full backend verification passed on 16 October: lint, documentation, OpenAPI,
build, **1,062 unit + 400 integration + 578 HTTP tests = 2,040 tests**.

## Not yet built / release acceptance

Frontend queue/status/regeneration/download screens and human four-language
acceptance remain. Open representative files in the
pilot's actual spreadsheet application and physically print at 100% scale
before accepting venue documents. Run worker/private-bucket recovery, privacy
and storage-outage drills on production infrastructure. Background seating is
implemented in its [separate worker](SEATING_WORKER.md); the final mixed-write/load
rehearsal remains a separate release gate.
