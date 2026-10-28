# Design decisions

> **Status: register, kept current.** Written on 13 October 2026. Updated on 18 October 2026:
> contract facts C-21 and C-22, assumption AS-12, five new questions, a correction to BQ-7, and the
> provisional defaults in §6, so that work can continue while the designer, product and the
> backend developer cannot answer.
>
> Every design statement in this folder falls into one of the kinds below. They are kept apart
> here so that nobody mistakes a recommendation or a working default for a decision.

## 1. How to read this file

| Prefix | Kind | Who can change it |
|---|---|---|
| **C-** | **Confirmed.** Decided by the designer, the frontend lead or the API contract | Whoever decided it |
| **R-** | **Recommendation.** Proposed in this design work, with a reason | Becomes C- when accepted |
| **AS-** | **Assumption.** Taken so work could proceed; may be wrong | Removed when verified |
| **DQ-, PQ-, BQ-** | **Open question,** for the **designer**, **product and the frontend lead**, or the **backend team** | Closed by the answer |
| **PD-** | **Provisional default:** what work builds on while a question is open (§6). Chosen to be cheap to reverse. Never a decision | Closed when its question is answered |
| **VR-** | **Review finding,** in [DESIGN_REVIEW.md](DESIGN_REVIEW.md) | Closed when fixed |

- **When a recommendation is accepted,** move it to §2 with the date and who decided, and update
  the document that specifies it.
- **When an answer changes a design,** update [GUEST_INVITATION.md](GUEST_INVITATION.md) or
  [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), and the artifact, in the same change.

The prefixes are deliberately different from `A1–A12` in the setup proposal, `B…`, `F…` and `D…`
in `docs/BACKLOG.md`, and `FR-…` in the setup proposal.

### 1.1 While questions are open

The designer, product and the backend developer could not answer as of 18 October 2026. Work
continues under these rules:

1. **Confirmed decisions bind.** Nothing provisional may contradict a C- item. Where a sample, a
   mockup or an artifact contradicts one, the C- item wins and the artifact is wrong. VR-02 is
   the example.
2. **Silence is not approval.** A recommendation stays an R- until its owner accepts it. Work
   builds on it only through a PD- that names it.
3. **Every default is cheap to reverse.** It lives in one token, one string, one configuration
   value or one component, and its row in §6 says what changes if the answer differs.
4. **The written specs govern the artifacts.** Where [GUEST_INVITATION.md](GUEST_INVITATION.md)
   or [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and a mockup disagree, the spec wins and the
   difference is a finding in [DESIGN_REVIEW.md](DESIGN_REVIEW.md). Where a PD departs from a
   spec line, the PD says so, and the spec line carries a ⚠ marker.
5. **No invented features** (C-9) and **no permanent workaround for a backend gap** (root
   `CLAUDE.md` §2). A temporary stand-in is allowed only when a BQ- records the need and the PD
   names its exit.
6. **Launch gates stay gates.** A default can carry development and review; it cannot carry a
   real guest. The gates are in [README.md §6](README.md#6-launch-gates).
7. **When an answer arrives,** record it in §2 with the date and who decided, mark the PD row
   "Closed", follow its "If the answer differs" column, and update the spec and the artifact in
   the same change.

---

## 2. Confirmed

### From the designer, 12 October 2026

The details are in [BRAND_BRIEF.md](BRAND_BRIEF.md).

| ID | Decision |
|---|---|
| C-1 | Brand name **AVELINE EVENTS**, tagline **"Your Dream Event Planner."** |
| C-2 | Elegant, timeless, sophisticated. Inspired by European luxury houses such as Dior and Cartier. Classic serif typography with a modern, minimalist approach. Premium and refined, never flashy, overly decorative or generic |
| C-3 | The supplied PNG is the logo. It is preserved and never redesigned or replaced |
| C-4 | Colours: primary `#4F002B`, accent `#C5A477`, additional accent `#B8A38E`, exactly |
| C-5 | Armenian, Russian and English, fully supported |
| C-6 | Headings in Noto Serif Armenian / Noto Serif; body text in Noto Sans Armenian / Noto Sans. Typography, hierarchy, weights, spacing and readability are consistent across the three languages |

### From the frontend lead

| ID | Decision | When |
|---|---|---|
| C-7 | The guest invitation is designed first, with a reusable design system. The organizer dashboard comes later. This matches A12 in [the setup proposal](../FRONTEND_SETUP_PROPOSAL.md#a12--design-first-or-features-first) | 12 October 2026 |
| C-8 | Mobile first. The phone layout is designed on purpose, never a squeezed desktop | 12 October 2026 |
| C-9 | No invented product features or backend capabilities. Every piece of sample content is marked as sample | 12 October 2026 |
| C-10 | Photographs from the reference sites may stand in as **placeholders** in the mockups. Each is registered in [PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md) and replaced with Aveline-owned images during development or before launch | 12 October 2026 |
| C-11 | The reference analysis is committed at the level of patterns, with nothing copied | 12 October 2026 |
| C-12 | Aveline appears on the guest page **once, as a discreet footer mark** | 12 October 2026 |
| C-13 | The designs are built directly as Claude Design artifacts. No separate design prompt is written | 12 October 2026 |
| C-14 | **Stack:** public pages are rendered on the server with React Router 8; the app uses Tailwind 4 and shadcn/ui; the invitation has a separate renderer driven by tokens and variants; translations use i18next. See setup proposal A1, A2 and §5.8 | 9 October 2026 |

### From the contract

Sources: `docs/API.md` and the backend source at `9c94415`.

| ID | Rule the design must keep |
|---|---|
| C-15 | There are 14 block types. Blocks render **in the order received**; an unknown type renders nothing; a `null` or unknown variant means the template's default |
| C-16 | Render the `locale` the response names. Format times in the **event's time zone** |
| C-17 | **One link answers for the household.** Each person is ATTENDING, DECLINED or UNDECIDED. Names added to the party are limited by `seatsAllotted`. A choice is sent as the option's **position**. A required custom question binds only guests who attend. A closed invitation stays readable (`isAcceptingResponses: false`) |
| C-18 | **Capability links are secrets:** not logged, not tracked, never in a screenshot with the token. Invitation pages are `noindex`. A link preview never names a guest (setup proposal §5.2) |
| C-19 | The cover is the **first photo of the HERO block**. The music is the **MUSIC block's audio**, with an explicit on/off control (PRODUCT_SPEC §5.1) |
| C-20 | **Templates are data:** `allowedFonts`, `palettes`, `supportedBlocks` and `defaultTheme`. Hosts choose within them and never edit layout |
| C-21 | **Closing stops every write.** A first answer and a change to an existing answer go through the same request (`POST /api/v1/invitations/:slug/g/:guestToken/rsvp`), which refuses both once the invitation is closed or past `expiresAt`. A closed invitation stays readable. Verified in `rsvp.service.ts` and `invitations.service.ts` on 18 October 2026 |
| C-22 | **`expiresAt` is a retention limit, not a reply-by date.** The retention sweep sets it from the plan's `invitationLifetimeDays`; past it, the invitation page itself returns `404` ("no longer available"). Null means indefinitely. Verified in the same files and `schema.prisma` on 18 October 2026 |

---

## 3. Recommendations

Status: **proposed**, until accepted.

### Visual identity

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-1 | An **ivory ground**. **Burgundy** for display type, the cover, the primary action and dark bands. **Gold and taupe** only as ornament on light grounds; they can be text on burgundy | The brand colours, constrained by verified contrast: the accents reach only 2.2–2.4:1 on light | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-2 | **Neutrals and derived colours:** ivory, porcelain, linen, ink, muted text, gold text, taupe text, field border, error, success, and hover and pressed burgundy | The brief gives three colours; a page needs text, surfaces and states. Each one is checked for contrast | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-3 | Use the logo's blush `#FFEBF6` for **headings on burgundy** | It ties the cover's type to the logo, at 13.5:1. Depends on DQ-2 | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-4 | **Square corners** (0–2 px) on buttons, cards, fields and images | Reads as couture and editorial, and differs from the pill shapes common in the category | [DESIGN_SYSTEM §5](DESIGN_SYSTEM.md#5-shape-lines-and-elevation) |
| R-5 | **The arch** as the one signature shape: the cover photograph's frame, with a gold hairline set off it. Used sparingly | It echoes the portals of Armenian churches and the logo's curved strokes, and neither reference uses it. Needs DQ-7 | [DESIGN_SYSTEM §5](DESIGN_SYSTEM.md#5-shape-lines-and-elevation) |
| R-6 | **Ornament** is limited to hairline rules, a small lozenge and the arch. No drawn flourishes, florals, textures or gradients | The brief asks for "refined rather than flashy, overly decorative" | [DESIGN_SYSTEM §5](DESIGN_SYSTEM.md#5-shape-lines-and-elevation) |
| R-7 | **Photography direction:** editorial and documentary, natural light, warm but true colour; 4:5 portraits on phones. Host photographs are shown as uploaded, with no filters | Matches the category's luxury cues without changing the host's photographs | [DESIGN_SYSTEM §6](DESIGN_SYSTEM.md#6-imagery) |

### Typography

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-8 | **Weights:** display in Noto Serif at 300–400, headings at 400–500, body in Noto Sans 400. Labels in Noto Sans 500 capitals at 12–13 px | Light display weights give the refined voice the brief asks for; body stays sturdy for reading on phones | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-9 | Compose each role from two families with `unicode-range`: **Armenian from the Armenian family; Latin, Cyrillic, digits and punctuation from Noto Serif or Noto Sans** | Correct coverage (the Armenian families lack Cyrillic, `№`, `₽` and U+202F), the same Latin design (verified identical) and smaller downloads | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-10 | **No meaning carried by italic, and no small capitals;** `font-synthesis: none` | Armenian has neither, so a browser would fake them | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-11 | **Armenian adjustments:** line height +0.05 to 0.1; tracking on capitals at most 0.08 em, against 0.14–0.16 em for Latin and Cyrillic | Armenian lowercase is shorter (492–502 against 536) and descends deeper. Needs DQ-9 | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-12 | Capitals are for **short labels only**, never sentences | Readability in all three scripts | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |

### The guest invitation

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-13 | **The "Maison" concept:** the invitation read like a folded card, cover first and then the letter. From 1024 px wide, the cover stays pinned on the left while the letter scrolls on the right | It gives the page one memorable idea that works at every width | [GUEST_INVITATION §2](GUEST_INVITATION.md#2-the-concept-maison) |
| R-14 | A **sticky reply bar** on phones and tablets. It shows only while replies are open and the reply section is off screen, and it clears the safe area | Both references keep the main action within reach on phones; the guest's main task is to reply | [GUEST_INVITATION §4](GUEST_INVITATION.md#4-page-anatomy) |
| R-15 | **Replying happens inline in the page, with progressive disclosure:** choose first, then the details appear; one submit | A modal on phones scrolls badly, and a short first step lowers the effort to reply | [GUEST_INVITATION §6](GUEST_INVITATION.md#6-replying-rsvp) |
| R-16 | The invitation **keeps its own palette whatever the device's dark mode**, and declares `color-scheme: light` | It is a designed object; forced darkening breaks it | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-17 | The **language switcher** appears only where switching works: wherever the event publishes more than one language. *23 October 2026: the backend built F16, so personal links have it too; switching does not change the guest's stored language* | A personalised link used to ignore `?locale` | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-18 | **No share button** on a personalised page | The link is the guest's credential; whoever holds it can answer for the household | [GUEST_INVITATION §12](GUEST_INVITATION.md#12-privacy) |
| R-19 | **Maps are links** (`mapUrl`), opening in a new tab with no referrer. No embedded maps | Content-security policy and privacy (setup proposal §5.11). Coordinates exist since 23 October 2026 (F9), and links still serve better | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |
| R-20 | **Music** never plays on its own. One labelled control, off at first | Browsers block autoplay, and PRODUCT_SPEC asks for an explicit control | [GUEST_INVITATION §10](GUEST_INVITATION.md#10-motion-and-sound) |
| R-21 | The **countdown** renders after hydration, does not announce itself to screen readers, and the date stays readable as plain text | It is time-dependent (setup proposal §5.2), and a ticking announcement is noise | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |
| R-22 | Times carry a **time-zone label** such as "Yerevan time" | Diaspora guests are a primary segment (PRODUCT_SPEC §10) | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-23 | The **footer** shows the logo file on a burgundy band, cropped with CSS. No words | Implements C-12. Needs no translation, and its background is the logo's own | [GUEST_INVITATION §4](GUEST_INVITATION.md#4-page-anatomy) |
| R-24 | **English dates** written day, month, year with a 24-hour clock | Matches the European positioning and the Armenian and Russian conventions. Needs PQ-4 | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-25 | **Russian copy avoids gendered greetings** ("Дорогой" or "Дорогая"); it uses the name plus a neutral sentence | The API holds no gender | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |
| R-26 | Counts are written **"Label: N"** where possible, otherwise with ICU plural rules | Russian has four plural categories; the label form avoids agreement errors | [GUEST_INVITATION §9](GUEST_INVITATION.md#9-languages) |

### Template data, for the backend to adopt later

| ID | Recommendation | Why | Specified in |
|---|---|---|---|
| R-27 | A template **"Maison"** (key `maison`). `allowedFonts` is `["Noto Serif Armenian", "Noto Sans Armenian"]`; `defaultTheme` is `{ "headingFont": "Noto Serif Armenian", "bodyFont": "Noto Sans Armenian", "palette": "bordeaux" }`. The renderer's font registry maps each name to its full stack | Templates are data (C-20). The brand fonts are guaranteed for Armenian, and the stack covers Russian | [DESIGN_SYSTEM §3](DESIGN_SYSTEM.md#3-typography) |
| R-28 | Two palettes, **"bordeaux"** (default) and **"champagne"**, with **named colour roles** | The renderer needs roles; today a palette is an unlabelled list. Needs BQ-1 and BQ-2 | [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| R-29 | **Variant names** for each block, declared in the template | `variant` is free text today (B46, F28) | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |
| R-30 | **Content fields** for each block, such as HERO `kicker`, `title`, `subtitle` | The backend stores free JSON per language; the editor and the renderer must agree on names | [GUEST_INVITATION §5](GUEST_INVITATION.md#5-blocks) |

### Product options, not part of the core concept

| ID | Option | Why it is only an option |
|---|---|---|
| R-31 | **Add to calendar:** an `.ics` file built in the browser from the event's times and venues | Not in PRODUCT_SPEC. It needs no backend, but it is still a new feature (PQ-5) |
| R-32 | **The guest's own local time,** shown beside the event time | Helps diaspora guests, but it is a new behaviour (PQ-6) |
| R-33 | A **full-screen photo viewer** for the gallery | A small interaction; useful, not essential |

---

## 4. Assumptions

| ID | Assumption | Checked by |
|---|---|---|
| AS-1 | `#FFEBF6` in the logo is intentional | DQ-2 |
| AS-2 | The brand name stays in **Latin letters** in every language, as in the logo | The designer |
| AS-3 | The tagline does not appear on the guest invitation; it exists in English only | DQ-5 |
| AS-4 | The first template uses the brand palette by default; hosts may pick the template's other palette | The frontend lead |
| AS-5 | Hosts supply their own photographs. Aveline offers no image library | Product |
| AS-6 | **Sample content:** the demo couple "Anna & Davit" from `backend/prisma/seed.ts`, the guest Armen Petrosyan and the Petrosyan family with 3 seats. Venue names, addresses, notes and the phone number are fictional | n/a |
| AS-7 | The dietary and drink options in the mockups are samples | PQ-1, PQ-2 |
| AS-8 | The mockups show every well-known RSVP question. Which ones a given invitation asks is still open | PQ-3, BQ-4 |
| AS-9 | The Armenian and Russian strings are drafts and need a native reader | DQ-9 |
| AS-10 | Most guests open the link on a phone, from a messaging app (PRODUCT_SPEC §12) | Pilot analytics are off by design; ask hosts |
| AS-11 | The narrowest supported screen is 320 CSS px. The designs are drawn at 360, 390, 768 and 1440 | The browser matrix (setup proposal §15 Q4) |
| AS-12 | The artifact versions dated 18 October 2026 (canvas `1792311698-0d0b`, design system `1792311699-2b48`) are automatic saves with no design change. `tokens.json` is unchanged, every review finding was re-verified against them, and the gallery shows both as last updated on 12 October. The 13 October source files were no longer on disk to compare byte for byte | Compare against these versions before the next design change ([DESIGN_REVIEW §3](DESIGN_REVIEW.md#3-what-was-checked)) |

---

## 5. Unresolved questions

**Every question here has a working default in [§6](#6-provisional-defaults),** so none of them
blocks development. Some block launch ([README §6](README.md#6-launch-gates)).

### For the designer

| ID | Question | Blocks |
|---|---|---|
| DQ-1 | Please supply the logo master as vector (SVG or PDF) and a transparent PNG, and confirm the clear space (one `AVELINE` cap height) and the minimum sizes (140 px on screen, 35 mm in print) | Using the logo anywhere but on burgundy |
| DQ-2 | Is the blush `#FFEBF6` in the logo intentional? Is it a brand colour? The concept uses it for headings on burgundy | R-3 |
| DQ-3 | Which colourways are approved: on light grounds, and single colour? | The logo on ivory, in print, on documents |
| DQ-4 | Is there a small mark or monogram for favicons, app icons and avatars? | The app shell, the browser tab |
| DQ-5 | Is the tagline translated into Armenian and Russian, or always shown in English? | AS-3 |
| DQ-6 | Please approve or correct the recommended neutrals and derived colours | R-2 |
| DQ-7 | Please approve the arch, the ornament vocabulary and the photography direction | R-5, R-6, R-7 |
| DQ-8 | Is the logo's display typeface a known font? Only to avoid lookalikes; the logo is never set in it | n/a |
| DQ-9 | Can a native reader review Armenian capitals with tracking, and every Armenian and Russian string? | R-11, AS-9 |
| DQ-10 | Please approve or change **square corners** (R-4), **capitals for labels and buttons** (R-8, R-12) and the concept's working name, **"Maison"** (R-13, R-27). *Added 18 October 2026* | The visual language; the template's name |
| DQ-11 | Is a **second palette, champagne,** wanted? *Added 18 October 2026* | R-28, the Cover-champagne board |
| DQ-12 | The review's design fixes (2, 3, 5–7, 9, 12–14, 17 and 21 in [DESIGN_REVIEW §5](DESIGN_REVIEW.md#5-fixes)): accept the directions in PD-14 and PD-27 to PD-37, or redraw? *Added 18 October 2026* | Those fixes |
| DQ-13 | Please design the **account pages** (sign-in, register, password reset, email check, accepting an invitation) and the app's first screens (creating the organization, the events home, the header with signing out). Built meanwhile on PD-39, with the app's kit mapped as DESIGN_SYSTEM §12 says. *Added 23 October 2026* | The way into the organizer app |
| DQ-14 | How should a **submit button look in the moment before the page is ready**? Until the page's JavaScript runs, a press would make the browser send the form itself, putting what was typed into the address. Built meanwhile on PD-41: disabled, without words. *Added 23 October 2026* | Send reply; every account form; the event forms; the guest dialogs and the import form |
| DQ-15 | Please design the **event screens**: creating an event, its overview with the guest numbers, correcting its details, and offering to tell guests about a change. Built meanwhile on PD-42. *Added 23 October 2026* | Creating, opening and correcting an event |
| DQ-16 | Please design the **guest list**: households and their guests, the search and the answer filter, adding, correcting, moving and removing a guest, a household's name and seats, and **importing a spreadsheet**, with the rows it refused and the past imports. Moving a guest between some 800 households needs a picker better than a native select. Built meanwhile on PD-44 and PD-45. *Added 24 October 2026* | Seeing, importing and keeping the guest list |
| DQ-17 | Please design the **venue screens** (the list, adding and correcting a venue with its arrival time, removing one), the **invitation's page** (what still blocks publishing, publishing with its warning that there is no way back, stopping and taking replies, sending with the first send's question and its outcome) and **who was invited, on the guest list** (each household's invitation line, the invitation filter, choosing households and sending to them). Built meanwhile on PD-46 to PD-49. *Added 25 October 2026* | Venues, publishing and sending |
| DQ-18 | Please design **the guest's reply after the backend's `eb77cd4`**: answering for each venue (the respondent's answers, and each member's following them until changed), the notice that the hosts changed how guests answer, the Reload offered when the invitation changed during a reply, and **agreeing to the hosts' statements**: the wording, whom the agreement covers and who already agreed, the declaration for the others, and signing by typing or drawing, with the drawing's saving and checking states. Built meanwhile on PD-50 to PD-52. *Added 28 October 2026* | The reply form |
| DQ-19 | Please design **the host's side of `eb77cd4`**: changing how guests answer (the preview of what is set back, the question, the offer to tell guests), the per-venue numbers on the overview, each guest's answers and seats per venue on the guest list, and the invitation's lifetime and expiry on the invitation page. Built meanwhile on PD-53 to PD-55. *Added 28 October 2026* | Changing how guests answer; the overview, the guest list and the invitation page |

### For product and the frontend lead

| ID | Question | Blocks |
|---|---|---|
| PQ-1 | Which **dietary options** do guests see? The API takes free strings, and the catering sheet counts whatever is sent, so the list must be fixed and translated. *23 October 2026: each invitation can now give its own choices (`rsvpFields`, BQ-9), and the form shows them. What is left for product: the default choices offered to a host* | The RSVP form |
| PQ-2 | Which **drink options** do guests see? The API takes one free string of up to 80 characters. *23 October 2026: as PQ-1, the invitation gives the choices; the default ones are product's* | The RSVP form |
| PQ-3 | Which **well-known questions** does each invitation ask (side, dietary, drink, song, message), and does the host choose them? *23 October 2026: the host chooses (BQ-4 answered). What is left for product: which are on by default* | The RSVP form, BQ-4 |
| PQ-4 | **English date and time format:** day-month-year with a 24-hour clock (R-24), or US style? | Formatting |
| PQ-5 | Offer **add to calendar** (R-31)? | n/a |
| PQ-6 | Show the **guest's local time** (R-32)? | n/a |
| PQ-7 | Who supplies the replacement **photography**, and when? | Launch (C-10) |
| PQ-8 | Should the footer mark **link to an Aveline website**? Capability pages strip the referrer, so a link is safe | The footer |
| PQ-9 | May the contact block name **Aveline** when Aveline itself organises the event? C-12 allows one appearance, the footer mark, and the sample content names Aveline as organiser (VR-02). *Added 18 October 2026* | The contact block |
| PQ-10 | Which **language** do the account and app pages show when nothing has chosen one? An invitation shows its event's; these pages have no event. *Added 23 October 2026* | Every account and app page (PD-40) |
| PQ-11 | When a host types a time that **does not exist** in the event's zone (the clocks go forward over it), or one that **happens twice** (they go back), what should happen? *Added 23 October 2026* | Events outside Armenia (PD-43) |

### For the backend team

These are candidates for `frontend/docs/BACKEND_REQUESTS.md` once that file exists (setup proposal
§3.6).

| ID | Question | Why it matters |
|---|---|---|
| BQ-1 | **The guest payload carries the palette's name, never its colours** (`theme.palette`). Can the payload include the resolved colours or tokens? | Without it the renderer needs its own copy of every template's palettes, and "templates are data" stops being true. This is the same problem as FR-9 for fonts |
| BQ-2 | **Palette colours have no roles,** and the two seeded templates order them differently: classic is background, accent, text; minimal is background, text, muted. Can palettes name their roles (R-28)? | A renderer cannot tell which colour is the text |
| BQ-3 | A host's own `colors` (1 to 8 values) have the same problem | Host-tuned palettes cannot render |
| BQ-4 | Nothing says **which well-known RSVP questions** an invitation asks. Could RSVP block `settings` carry it? **Answered 23 October 2026:** the invitation carries `rsvpFields`, switching each on or off; a switched-off one is refused | PQ-3 |
| BQ-5 | A **required SIGNATURE question** cannot be answered, but required questions bind attending guests, so every attending guest would be refused. Can creating one be refused, or the requirement skipped? **Answered 23 October 2026 (B69):** creating one is refused, and so is changing a question into one, until signatures can be captured (F25) | Guests unable to reply |
| BQ-6 | API.md §6 says the public page leaves out `settings`, but the code returns each block's `settings`. The dress-code swatches need them. Which is right? | DRESS_CODE |
| BQ-7 | There is **no reply-by date** in the payload, only `isAcceptingResponses`. A "please reply by" line is free text today. Should `expiresAt` be exposed? **Corrected on 18 October 2026:** `expiresAt` is the retention limit (C-22), so exposing it would not give a reply-by date. The question is whether an invitation should have a separate, optional reply-by date, and whether replies should close on it by themselves. Closing is manual today | The RSVP block's copy; the closed state |
| BQ-8 | The development and production seeds name theme and palette fields differently (`font` and palette `key`, against `bodyFont` and palette `name`), and theme validation reads `name`. **Answered 23 October 2026 (B84):** the development seed now uses the names the code reads, palette `name` and the theme's `headingFont` and `bodyFont`; the production seed already used `name` and `bodyFont` | The renderer's theme parsing |
| BQ-9 | If product chooses fixed dietary and drink options (PQ-1, PQ-2), can each invitation define its own, as custom questions do? Today `dietary[]` and `drinkPreference` are free strings with no option list. *Added 18 October 2026.* **Answered 23 October 2026:** `rsvpFields` gives dietary and drink their own choices, a key with a label per language; without choices they stay free text | The RSVP form; the catering sheet |
| BQ-11 | `guest.telegramLink` opens the event's Telegram bot with **the guest's own token** in the link (`?start=<token>`). The token is the guest's credential to their page and reply, so Telegram receives it, and so does anyone the link is forwarded to. Could the bot link carry a separate, single-purpose code instead? *Added 23 October 2026. Since the same pull, Aveline's invitation email also ends with this link whenever a bot is configured* | A "get reminders on Telegram" button; it is not shown until this is settled |
| BQ-10 | Could dress-code colours carry optional names in each language, so that screen readers can say them (VR-35)? Low priority. *Added 18 October 2026* | DRESS_CODE |

### From the review page

The [review page](https://claude.ai/artifact/XGY21GRtMK6JFueWda51YM) of 13 October numbered its
questions Q1–Q11. They map to this register:

| Review | Register | Review | Register |
|---|---|---|---|
| Q1 blush | DQ-2 | Q7 options per event | BQ-9 |
| Q2 derived colours | DQ-6 | Q8 palette colours | BQ-1, BQ-2 |
| Q3 corners, capitals, "Maison" | DQ-10 | Q9 reply-by date | BQ-7 |
| Q4 champagne | DQ-11 | Q10 does closing block changes? | **Answered by the code: C-21** |
| Q5 Aveline in the contact block | PQ-9 | Q11 colour names | BQ-10 |
| Q6 fixed options or free text | PQ-1, PQ-2 | | |

**Existing backlog items the design depends on:**

| Item | What the design waits for | State on 23 October 2026 |
|---|---|---|
| F16 | Switching language on a personalised link; translatable host and venue names | Built; the page uses it |
| B33 | Matching a timeline entry to its venue | Built; the timeline names the venue |
| B16 / D4 | Find your seat through the guest's link | Built (`guest.seating`); not designed yet |
| F9 | Venue coordinates | Built; the page keeps map links (R-19) |
| F11 | Alt text on uploads | Built; the page uses it |
| F18 | Image resizing | Built; the page uses the smaller copies |
| F28 | Variants declared in the template | Open: now only the template preview |
| FR-9 | How template fonts reach the browser | Open |
| B49 | A private invitation readable through its generic URL | Fixed: a private event's generic link is a 404 |

---

## 6. Provisional defaults

Status: **working defaults, not decisions.** Written on 18 October 2026, when none of the owners
could answer. Each row names the open item it stands in for, what to build on meanwhile, and what
changes if the answer differs. The rules are in [§1.1](#11-while-questions-are-open).

**In code since 22 October 2026** (`frontend/src/`), each named in a comment where it applies:

| Defaults | Where |
|---|---|
| PD-1, PD-2, PD-19 | The footer mark and the favicon: `features/invitation-renderer/components/footer-mark.tsx`, `public/favicon.svg` |
| PD-9 | Every Armenian and Russian string in `locales/`, and the Armenian date words in `lib/time` |
| PD-10, PD-12 | `styles/app.css` (Armenian tracking) and the cover's date line (Russian in sentence case) |
| PD-11 | `lib/time`: day, month, year; a 24-hour clock |
| PD-38 | `features/guest-reply/`: each attending member and added guest answers the host's questions under their name |
| PD-21 | `features/invitation-renderer/theme.ts`: bordeaux only |
| PD-39 | `features/account/components/account-layout.tsx` and `app-shell.tsx`; the radius in `styles/app-kit.css` |
| PD-40 | `lib/i18n/negotiate.ts`, read by the account routes and the `/app` layout |
| PD-41 | `ui/use-is-hydrated.ts`, read by Send reply (`guest-reply/components/reply-form.tsx`) and by `SubmitButton` in `ui/app-form/`, which the account forms, the event forms, the guest dialogs, the import form and the venue form use |
| PD-42 | `features/events/components/`, and the kit's `native-select.tsx`, `checkbox.tsx` and `textarea.tsx` |
| PD-44 | `features/guests/components/`: `guest-directory.tsx`, `household-card.tsx`, the dialogs, and the kit's `dialog.tsx` |
| PD-45 | `features/guests/components/import-guests.tsx`, `import-result.tsx`, `import-history.tsx` |
| PD-43 | `lib/time/zoned-input.ts`: `instantFromWallTime`, read by the event form and the venue form |
| PD-46 | `features/venues/components/`: `venue-list.tsx`, `venue-form.tsx`, `venue-fields.tsx`, `venue-pages.tsx`, `remove-venue-dialog.tsx` |
| PD-47 | `features/sending/components/`: `invitation-page.tsx`, `publish-panel.tsx`, `replies-panel.tsx`, `send-panel.tsx`, `send-confirm-dialog.tsx`, `send-outcome.tsx`, `use-send.ts`; the first send's question in `features/sending/send.ts`; the link in `features/events/components/event-overview.tsx` |
| PD-48 | `features/sending/`: `components/delivery-line.tsx`, `delivery.ts` (the filter's groups) and `delivery-text.ts`; `features/guests/`: `filter.ts`, `load.ts`, and in `components/` `guest-directory.tsx`, `household-card.tsx`, `list-toolbar.tsx`, `send-bar.tsx`, `sending-notes.tsx`, `use-send-from-list.ts` |
| PD-49 | `features/sending/blockers.ts`: the three blockers' English sentences; shown by `components/blocker-list.tsx` |
| PD-50 | `features/guest-reply/attendance.ts`, `components/household-sections.tsx` (`AnswerSection`, `MemberVenues`), `saved-reply.tsx` |
| PD-51 | `features/guest-reply/form-model.ts` (`carryOver`), `server-errors.ts`, `components/reply-form.tsx` (`ReloadNotice`, `ReconfirmNotice`), `components/guest-reply.tsx` (`useReload`); `api/retry.ts` |
| PD-52 | `features/guest-reply/signatures.ts`, `acknowledgements.ts`, `signature-upload.ts`, `strokes.ts`; `components/signature-section.tsx`, `signature-pad.tsx`, `use-signing.ts` |
| PD-53 | `features/events/attendance.ts`, `components/attendance-mode.tsx`, `headcount-summary.tsx` (`VenueTable`), `event-overview.tsx`; `routes/app/event-attendance.tsx` |
| PD-54 | `features/guests/read.ts`, `components/household-card.tsx` (seats, venue answers), `refusals.ts` (the removal sentences) |
| PD-55 | `features/sending/components/invitation-page.tsx` (`Lifetime`), `send-panel.tsx`, `replies-panel.tsx`, `refusals.ts`, `delivery-text.ts`; `features/venues/refusals.ts` (the venue sentences); `features/guests/components/guest-directory.tsx`, `sending-notes.tsx` |
| PD-24, PD-26 | `schemas.ts` reads six-digit hex from `settings.palette`; the swatches are one labelled image |
| PD-25 | No deadline is computed; `isAcceptingResponses` alone decides |
| PD-27, PD-31 | The reply bar (`components/reply-bar.tsx`) and the cover's Reply on desktop |
| PD-28, PD-32, PD-33 | `ui/form/`: three stacked choice cards, segmented member controls, radio cards for drink |
| PD-29 | Names are unbreakable spans on the personal card and in the reply confirmation |
| PD-35 | The countdown: days, hours, minutes; once a minute; after hydration |
| PD-36 | "Thank you" replaces the reply section's heading once sent |
| PD-37 | Undrawn states built from the spec; the open card checked at 1,024 px in a browser. The `full-bleed` cover falls back to the arch |

### Brand and visual system

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-1 | DQ-1, DQ-3: no vector, transparent or light-ground logo | The supplied PNG, unchanged, only on `#4F002B`, cropped with CSS as `FooterMark` does. Clear space of one `AVELINE` cap height; the lockup at least 140 px wide. No logo on ivory, photographs, print or icons | New files only add placements. Nothing already built changes |
| PD-2 | DQ-4: no small mark | Nothing is derived from the logo (C-3). Where a favicon is required, a plain `#4F002B` square | One file to replace |
| PD-3 | DQ-5: tagline translations | The tagline stays in English and never appears on the guest page (AS-3) | One string |
| PD-4 | DQ-2: is blush a brand colour? | `brand-blush` keeps its current roles and gains no new ones: display type, headings, the primary action and the focus ring on burgundy (the Bordeaux `heading`, `action` and `focus` tokens) | Point those three tokens at `ivory`, which keeps 12.51:1 or better on every Bordeaux surface. A token change; no component changes |
| PD-5 | DQ-6: the derived colours | The R-2 values exactly as in `tokens.json` (SHA-256 `713cbb7ca577b318…`), used only through semantic tokens. No raw hex in components | Change the token, then re-run the contrast checks in [DESIGN_SYSTEM §2](DESIGN_SYSTEM.md#2-colour) |
| PD-6 | DQ-7: the arch, ornament, photography | Kept as specified, with the arch confined to `ArchFrame` (the cover and the signature) | `ArchFrame` becomes a square 4:5 frame: one component |
| PD-7 | DQ-10: square corners, capitals, the name "Maison" | Corners only through the radius tokens. Capitals only through the `eyebrow` and `button-text` styles (`text-transform`), so every string is stored in sentence case. "Maison" is an internal working name, shown to no host or guest | A token, a style or a label each |
| PD-8 | DQ-11: a champagne palette | Not built. Only bordeaux is built; the Cover-champagne board stays an exploration | Nothing to undo |

### Language and copy

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-9 | DQ-9: Armenian and Russian copy | English is the source. Armenian and Russian strings, including any new ones, are drafts, marked for review wherever they are stored | Strings only. A native reading is a launch gate |
| PD-10 | DQ-9, VR-16: Armenian capitals | The design system's rule: labels and buttons in capitals by `text-transform`, tracked 0.08 em and 0.06 em. The canvas's sentence-case Armenian music label is the exception, and is treated as wrong | Drop `text-transform` under `:lang(hy)`: one rule |
| PD-11 | PQ-4: English date format | Day, month, year and a 24-hour clock (R-24), from one formatter | One setting |
| PD-12 | VR-17: Russian dates in capitals | Russian dates are not set in capitals; they stay in sentence case under `:lang(ru)` | One rule |
| PD-13 | VR-03, C-21: the line under Send reply and in the confirmation | "You can change your reply with this link while replies are open." Never "at any time". **Closed 18 October 2026:** fix 16 put this line in the spec and on both artifacts. It rests on C-21, a contract fact, so it no longer depends on an answer; only its Armenian and Russian drafts wait for a native reader (PD-9) | One string per language |
| PD-14 | VR-15, VR-28, VR-32, VR-33: copy where the spec and the artifacts differ | The spec's wording wins: the closed-state line, "Attending · 3 people" with plural rules, and the network error with its reference code. English uses typographic apostrophes (’). *18 October: the closed line and the apostrophes are applied on the artifacts (fixes 18, 19); the status unit and the reference code wait for the designer (fixes 17, 21)* | Strings only |

### Product

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-15 | PQ-1, PQ-2, BQ-9: dietary and drink options | The sample lists already drawn, in one configuration file with their translations, sending the same English key in every language. **Closed 23 October 2026:** BQ-9 was answered. The form now shows the invitation's own choices (`rsvpFields`), sending their keys, and free text where it gives none; the sample lists are gone from the code | Nothing to undo |
| PD-16 | PQ-3, BQ-4: which well-known questions an invitation asks | All of them, all optional, each behind one renderer switch. **Closed 23 October 2026:** BQ-4 was answered. The form asks exactly what `rsvpFields` switches on; the side also needs both side labels | Nothing to undo |
| PD-17 | PQ-5, PQ-6: add to calendar; the guest's local time | Neither is built. Times show the event's zone with its label (R-22) | Nothing to undo |
| PD-18 | PQ-7: replacement photography | Placeholders stay only on the private canvas. Code, fixtures and demos use no photographs: the typographic cover and plain `sand` blocks | Nothing to undo. Replacing the placeholders is a launch gate |
| PD-19 | PQ-8: a link on the footer mark | The footer mark is not a link | One attribute |
| PD-20 | PQ-9, VR-02: Aveline in the contact block | C-12 governs: Aveline appears once, as the footer mark. Sample organisers are fictional people. The "Aveline Events" sample on the canvas and in [GUEST_INVITATION §13](GUEST_INVITATION.md#13-sample-content) is treated as an error | If product allows the exception, amend C-12 in writing first |

### Backend

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-21 | BQ-1 to BQ-3: palette colours and roles | **A temporary stand-in:** one renderer module maps a palette name to named roles and holds only "bordeaux" (R-28). Any other name falls back to the template's default palette, and a host's own `colors` are ignored. Nothing else may be added to it. The demo event therefore renders in bordeaux, not in its seeded "ivory-gold" | Delete the module and read the colours from the payload once BQ-1 and BQ-2 are answered. It must not outlive them (rule 5) |
| PD-22 | BQ-8: theme field names differ between the seeds | Read only the shape `docs/API.md` documents. Anything missing falls back to the template's default theme. **Closed 23 October 2026:** BQ-8 was answered. The renderer reads only `theme.palette`, which the seeds and the code now name alike | Nothing to undo |
| PD-23 | BQ-5: a required SIGNATURE question blocks attending guests | SIGNATURE questions are never shown (spec §6.1g). If the server refuses a reply because of one, the guest sees the validation-error state. **Closed 23 October 2026:** BQ-5 was answered; the backend refuses to create one. The form still leaves the type out until signatures can be captured (F25), and keeps the refusal fallback. **Replaced 28 October 2026 by PD-52:** the backend allows SIGNATURE questions again (`eb77cd4`), and the reply form asks for the agreement | Nothing to undo |
| PD-24 | BQ-6: are block `settings` public? | Use `settings` when the response carries them, as the code does today. The swatches render only from valid hex values in `settings.palette`; otherwise the dress code is text only | Nothing to undo |
| PD-25 | BQ-7, C-22: no reply-by date | No deadline is shown except the host's own words in the RSVP block. Nothing is computed from `expiresAt`. `isAcceptingResponses` alone decides whether the form shows | Add a date line if a field arrives |
| PD-26 | BQ-10: names for swatch colours | The swatches stay unnamed, labelled "Suggested colours". The dress-code text carries the guidance | Add the names as labels |

### The review's design fixes

Directions for the designer-owned fixes in [DESIGN_REVIEW §5](DESIGN_REVIEW.md#5-fixes), until the
designer answers DQ-12. None is applied to the artifacts yet.

| ID | Finding and fix | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-27 | VR-29, fix 2: the answered reply bar wraps | Below 480 px the status sits above a full-width secondary "Change reply"; from 480 px they share one row | One component's layout |
| PD-28 | VR-07, VR-21, VR-36, fix 3: labels wrap inside answer controls | The three attendance cards stack vertically at every width, as on phones. In the per-person control a label may wrap to two centred lines, and the three segments share one height. Checked in Russian at 320 px | One component's layout |
| PD-29 | VR-01, fix 4: names split | A name, or "1 seat to name", never breaks inside; lines wrap only between items. *The mockups follow it since 18 October (fix 4); it stays the rule for code* | Nothing to undo |
| PD-30 | VR-05, fix 5: the first screen | The first screen shows the occasion, the hosts and the date, and the guest's name comes within one scroll (spec §1). The personal card either shows its greeting above the reply bar or starts below it; a lone label never peeks out | Cover spacing only |
| PD-31 | VR-04, fix 6: two Reply buttons | The reply bar also hides while the personal card's Reply is on screen, extending R-14. On desktop the cover's Reply becomes the reply status once the reply section is in view | One visibility rule |
| PD-32 | VR-09, fix 7: single choice looks like multiple choice | Single-choice options, drink included, use the ChoiceCard (radio) style; chips are for multiple choice only. This departs from spec §6.1e ("single-choice chips"), which carries a ⚠ marker | Swap one control back |
| PD-33 | VR-08, VR-12, VR-31, fixes 8 and 9: selected answers and card sizes | The design system's ChoiceCard governs: its own radio mark, a check on every selected card, and 56 px for every option card | One component |
| PD-34 | VR-23, fix 12: text over photographs | Small text over a photograph is ivory or blush only, on `burgundy-deep` (`#3A0020`) at 65% opacity or more where the text sits. That holds 4.5:1 even over a pure-white area. Gold and taupe text stay off photographs; they would need 83% or more | One scrim value |
| PD-35 | VR-34, fix 13: the countdown ticks every second | The `numerals` countdown shows days, hours and minutes, and updates once a minute. This departs from spec §5's seconds, which carry a ⚠ marker | Add the seconds unit back |
| PD-36 | VR-14, fix 14: the sent state | "Thank you" replaces "Kindly reply / Will you join us?" as the heading, with the confirmation sentence under it; focus moves to the heading (spec §6.2) | Heading text only |
| PD-37 | VR-18, VR-25, VR-26, fix 15: states and sizes not drawn | The undrawn states are built from the spec's words (§6.2, §7) with the existing components, and drawn later. Until a 1,024 px board exists, the open card is checked at 1,024 px in a browser | Adjust to the drawings when they arrive |
| PD-38 | The backend's rule of 23 October 2026 (docs/API.md §4): a required question binds every attending member and added guest, and each answers for themselves. Not drawn | Under each attending member's name, and each added guest's, their own copy of the host's questions, then their dietary needs folded away as spec §6.1d draws them. The respondent's own questions go under their name when anyone else is on the form. Members' earlier answers are not shown on an edit, since the API does not return them (FR-21) | Adjust to the drawing when the designer draws it |

### Account and app pages

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-39 | DQ-13: the account and app pages are not designed | One centred column on `ivory`, at most 26 rem wide: the wordmark in serif capitals and the language switcher, then a card with a serif title. The app has a header with the wordmark, the switcher and signing out. Built from the shadcn/ui kit (C-14) mapped onto the tokens exactly as [DESIGN_SYSTEM §12](DESIGN_SYSTEM.md#12-from-invitation-to-dashboard) tabulates, at the app's density: 14–15 px text, 40 px controls, 44 px on touch. Square corners, since §12 allows 0 or 2 px; radio buttons stay round | The layout lives in `AccountLayout` and `AppShell`, and the radius in `src/styles/app-kit.css` |
| PD-40 | PQ-10: the language of the account and app pages | `?lang=` when the switcher sets it, remembered in an `aveline-lang` cookie; otherwise the browser's `Accept-Language` among hy, ru and en; otherwise English. The cookie is not a credential. Invitations ignore it and keep their event's `locale` | One function, `src/lib/i18n/negotiate.ts` |

### Forms before the page is ready

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-41 | DQ-14: a submit button before the page is ready | Send reply and the submit buttons of every account form, event form, guest dialog and the import form are disabled until the page's JavaScript runs, usually well under a second, and the form posts. No words explain it, since the state clears itself. This departs from DESIGN_SYSTEM §10 ("the reason is given in text nearby"), which carries a ⚠ marker | Add a line under the button, or the button's normal look, in `useIsHydrated`'s two users; the button stays disabled either way |

### Event screens

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-42 | DQ-15: the event screens are not designed | Built on PD-39, in the app's frame. **Forms** for creating and correcting, at most 30 rem wide, in this order: the kind of event, a native select with no default ("Choose…"); the title; the hosts, optional when creating, where the title stands in; the date and the time, the browser's own inputs, side by side from 480 px; the time zone, a native select of IANA names as the API stores them (an underscore shown as a space), preselected on Asia/Yerevan; the languages, checkboxes for hy, ru and en in their own names, plus any other the event already has; the default language, radios among the ticked ones. **The overview:** the title and "Edit details", then the details (kind, hosts, the start in the event's zone with the zone named, the languages with the default marked, the invitation's status and link name), then the headcount as seven numbers, without a chart. **Home:** each event's title links to its overview; "Create an event" sits by the heading once there are events, and an empty list offers "Create your first event". **"Let your guests know"** replaces the edit form once a save suggests it, with an optional note and "Not now". Every action is shown to every role, and a 403 is explained (FR-6). The native time input is drawn by the browser: one set to US English shows a 12-hour clock, unlike PD-11. Its value is always 24-hour | Adjust the components in `src/features/events/components/` to the drawings. A drawn date or time picker replaces the native inputs in `event-fields.tsx` only |
| PD-43 | PQ-11: a typed time the clocks skip or repeat in the event's zone | A time the clocks skip, when they go forward, is refused on the time field, which says why. One they repeat, when they go back, is the earlier of the two. Asia/Yerevan has had no clock change since 2012, so Armenian events never meet either | One function: `instantFromWallTime` in `src/lib/time/zoned-input.ts` |

### Guest list

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-44 | DQ-16: the guest list is not designed | Built on PD-39 and PD-42, in the app's frame. **The page:** "Back to the event", the title "Guests" with the event's title under it, "Add a guest" and "Import a spreadsheet". **A toolbar** kept in view while the list scrolls: a search by guest or household name, ignoring case and accents, and an answer filter as a native select (any, coming, not coming, not sure yet, not answered). Both are kept in the address (`?q=`, `?answer=`), and follow it on Back. A line under it gives the totals, or what the filter shows. **Households** in the API's order, never re-sorted: each a card with its name as a heading, "2 of 3 seats named", "Edit household" and, while a seat is free, "Add a guest here". A household whose name matches shows all its guests; otherwise only the guests who match. **Each guest:** the name; the answer in the guest page's `StatusChip`, "Not answered" without a mark; the side in the event's own label, nothing when unknown; the table; "Receives the invitation", "Added by their household", "Checked in", "Details erased at their request"; the email and phone when this role sees them; "Edit" (not for an erased guest) and "Remove". Without contact access, one line says so and the forms leave email and phone out. **Dialogs**, at most 30 rem wide, for adding, correcting (which also moves the guest, through a native select of the households with a free seat) and a household's name and seats; the side is asked only when the event names both sides, as the guest page does, or when the guest already has one. **Removing** asks first, in the kit's alert dialog, saying what goes with the guest; a checked-in guest gets the reason and only "Close". **After a save** the list reloads, a status line says what happened, and the focus goes back to the button that opened the dialog, or to the status line when that button is gone. Every action is offered to every role, and a 403 is explained (FR-6) | Adjust the components in `src/features/guests/components/` to the drawings. A drawn household picker replaces the native select in `guest-fields.tsx` only |
| PD-45 | DQ-16: importing a spreadsheet is not designed | Its own page, under the guest list. **The lead** gives the limits (CSV, 2 MB, 2,000 guests), the columns recognised in words, and asks for "CSV UTF-8 (comma delimited)" from Excel (FR-27). **The form:** the browser's own file input and "Import"; no file, and a file over 2 MB, are refused before anything is sent. **The result** of a 201, partial or not: a heading saying how many were imported and how many rows were not (only "Nothing was imported" when the file itself was refused), which takes the focus; the refused rows listed by the spreadsheet's own number ("Row 7"), row 0 read as "The file", the backend's English reason marked as English and, on a page in another language, a line saying so (FR-26); the refused cell quoted. The upload stays beside it, as "Import the corrected file". **Past imports** under it: the file's name, the date in the event's zone, the counts, the status, and the refused rows folded into a native disclosure | Adjust the components named in the table above to the drawings |

### Venues, publishing and sending

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-46 | DQ-17: the venue screens are not designed | Built on PD-39 and PD-42, in the app's frame. **The list:** "Back to the event", the title "Venues" with the event's title under it, a line saying what venues are for and that publishing needs one with an address, "Add a venue", then each venue as a card in the API's order, never re-sorted: its role ("Getting ready: not shown to guests" for a preparation venue), its name as a heading, its address, "Guests arrive at 14:30, Saturday, 12 June 2027 (Asia/Yerevan)" in the event's zone, "Directions" opening the map link in a new tab only when it is an http or https link (otherwise a line says guests are not shown it), "Edit" and "Remove". **Adding and correcting** are pages with one form at most 30 rem wide: what happens there (a native select with no default), the name, the address, the map link (http or https only), and when guests should arrive, the browser's own date and time inputs side by side from 480 px, both or neither, in the event's zone, which the help names. No coordinates (R-19), capacity, translations or directory. **Removing** asks first in the kit's alert dialog; a venue still in use is refused with our words and the backend's sentence in English. **After a save or a removal** whose notice suggests it, "Let your guests know" replaces the form or the list, as PD-42's does; "Not now" goes back. Every action is offered to every role, and a 403 is explained (FR-6) | Adjust the components named in the table above to the drawings |
| PD-47 | DQ-17: the invitation's page is not designed | Built on PD-39, in the app's frame, at "Publish and send", linked from the event's overview. "Back to the event", the title, the invitation's state and link name, and a status line that speaks, with the focus, once an action's reloaded page is on screen. **A draft:** "Publish", with everything that still blocks it listed at once (PD-49), each linked to its fix; "Publish the invitation" is disabled while anything blocks it, with the reason beside it (DESIGN_SYSTEM §10). Publishing asks first, in the kit's alert dialog, which says guests can open their links from then on and that **it cannot go back to being a draft**. **Published:** "Replies", with "Stop replies" and, once stopped, "Take replies again", neither asking first, the words beside them saying what each does. "Send the invitation": the delivery report's counts (invited, not yet, cannot be reached), the way to the guest list, and "Send to every household not yet invited". **The event's first send asks once**, naming how many households it reaches, how many it cannot, and that sent messages cannot be recalled; every later press sends at once, the button disabled only while its request runs. **The outcome**, which takes the focus: on its way (with a native disclosure of who, by which channel), already invited, not sent (with what to do for a bounce and for an opt-out), cannot be reached (each reason in English, FR-33) with the way to those households on the guest list. While replies are stopped, sending is not offered, since the backend refuses it, and a line says why | Adjust the components named in the table above to the drawings |
| PD-48 | DQ-17: who was invited, on the guest list, is not designed | On each household card, under its seats, "Invitation:" and one line: what happened (not sent yet, waiting, being tried again, going out, sent, delivered, could not be sent, bounced, not sent because they cannot be contacted, withdrawn), to whom, how (the channel, and the address when this role sees it; a Telegram chat number is never shown), when it was sent in the event's zone, and the reminders; then the mail server's own words in English, only when the address is shown too (FR-35), and what to do, with an icon, when it needs attention. A household nothing can reach says so with the reason in English. **An "Invitation" filter** in the toolbar, while there is a report: any, not sent yet, on its way, sent, needs attention, kept in the address (`?invite=`). **While published,** a "Choose" box on each household and, in the toolbar kept in view, how many are chosen, "Choose all shown", "Clear the choice" and "Send to N households", disabled with its reason when none is chosen or more than 1,000 are. The first send asks as PD-47's does; the outcome appears above the list and takes the focus. A draft or a stopped invitation gets one line with the way to "Publish and send", and no boxes | Adjust the components named in the table above to the drawings |
| PD-49 | FR-32: the publish blockers have no codes, only English sentences | **A temporary stand-in:** one module (`features/sending/blockers.ts`) recognises the three sentences the backend has by their exact text, so the page says each in its own language and links it to its fix (a venue; the event's details; the RSVP block, whose fix is not built yet). Anything else, a reworded sentence included, is shown as it came, marked as English, never as a wrong fix. Nothing else may be added to it. The need is recorded as FR-32 in BACKEND_REQUESTS, the frontend's register of backend requests | Delete the module and read the codes once FR-32 is answered. It must not outlive it (rule 5) |

### Following the backend's `eb77cd4`

| ID | Open item | Build on this meanwhile | If the answer differs |
|---|---|---|---|
| PD-50 | DQ-18: answering per venue is not designed | Under "Your answer", one group per guest-facing venue in the host's order, each with the three answer cards; **the respondent must answer every venue**. Each household member gets one segmented choice per venue, named "Lusine Petrosyan · Hall", starting on the respondent's answer there ("same as me", as PD-28) until changed; what is shown is sent, since the backend makes nobody follow in this mode. A guest added on the reply comes where the respondent comes. Someone coming to any venue is coming: they get the questions and details. The saved reply lists each venue's answer. Venue names are the personal page's, in its language (FR-40) | Adjust `household-sections.tsx` and `saved-reply.tsx` |
| PD-51 | DQ-18: the reply when the hosts changed something meanwhile is not designed | A notice at the top of the form when the hosts changed how guests answer and this guest has not answered again. A reply refused because the invitation changed (409) offers **Reload**, never Retry: the reply is read again and the form starts from it, **keeping what was typed** (details, questions, message, added guests) and asking again who comes where and the agreements. A reply refused because the link no longer opens the invitation (404) says so and offers nothing. The guest page's own read is tried once more on a 409 "changed while loading" | Adjust `reply-form.tsx` |
| PD-52 | DQ-18: agreeing to the hosts' statements is not designed; replaces PD-23 | One section per statement anyone coming has not agreed to in its current wording, after the answers: the wording quoted in the language it is recorded in, "For: …", "Already agreed: …", **"I agree"**, marked Required or Optional. Once ticked: **"I agree on behalf of …"** when it covers anyone but the respondent (the backend's representative declaration), then **"Type my name" or "Draw my signature"**, and the respondent's full name, **left empty**: typing it is the act of signing. Drawing is a plain canvas, with "Use this signature", "Clear", "Draw again" and **"Type your name instead" always offered** (WCAG 2.5.7); the drawing is saved, then checked by the backend for up to half a minute, each state said in a status line. An optional statement is all or nothing for the people listed. The saved reply says who in the household has agreed. Who already agreed comes from the agreements read in the browser (FR-37); while it loads, everyone coming is asked | Adjust `signature-section.tsx` and `signature-pad.tsx` |
| PD-53 | DQ-19: changing how guests answer is not designed | Its own page, "How guests answer", linked from a row on the overview. It says how guests answer now and what the other way means; **"See what would change"** previews it: how many answers go back to "not answered", and that seated guests keep their seats, held until they answer again. The change ("Ask per venue", "Ask once for the event") asks first in the kit's alert dialog, saying changing back later asks again too. Then, with an invitation, the offer to tell guests, as after an edit, saying they are asked to answer again (no count, FR-39; **no note written in advance**). A preview gone stale starts again, saying why; a per-venue change with no venue guests see links to the venues. The overview adds a "By venue" table of answers, only when guests answer per venue | Adjust `attendance-mode.tsx` and `headcount-summary.tsx` |
| PD-54 | DQ-19 and FR-28: the guest list after `eb77cd4` | Each guest's row names every seat at its venue ("Seated at Table 4 (Hall)"), one held while they have not said they are coming there ("…, held until they answer"), each venue's answer when guests answer per venue, and "Asked to answer again". **A temporary stand-in:** a removal refused for a ticket-linked guest or for a recorded agreement is recognised by its exact English sentence and worded as its own reason; anything else keeps the check-in's words, as before. Deleted when FR-28 gives codes | Adjust `household-card.tsx`; delete the sentences in `refusals.ts` once FR-28 is answered |
| PD-55 | DQ-19 and FR-28: the invitation's lifetime is not designed | The invitation page adds "Guests can open it: until 11 September 2027, 00:00" in the event's zone, "with no end date", or "no longer: its time has run out". Once expired, sending is not offered (here and on the guest list), with the reason, and a line says taking replies again will not let guests open it. A delivery line adds when the message was read, and a failure the provider put down to our own set-up says it is not the guest's to fix. **A temporary stand-in:** an expired send, a venue removal refused for answers, and a venue that must stay shown to guests are recognised by their exact sentences (FR-28) | Adjust the components named in the table above; delete the sentences once FR-28 is answered |

---

## 7. Out of scope

Not designed now, each for the reason given:

| Not designed | Why |
|---|---|
| The organizer dashboard and app screens beyond the way in, an event's details, its guest list, its venues, its invitation's publishing and sending, and how guests answer | C-7. [DESIGN_SYSTEM §12](DESIGN_SYSTEM.md#12-from-invitation-to-dashboard) maps the tokens. The account pages and the app's first screens are built on PD-39 since 23 October 2026, and wait for DQ-13. Creating, opening and correcting an event are built on PD-42 the same day, and wait for DQ-15. The guest list and its import are built on PD-44 and PD-45 since 24 October 2026, and wait for DQ-16. Venues, publishing and sending are built on PD-46 to PD-49 since 25 October 2026, and wait for DQ-17. Changing how guests answer and the rest of `eb77cd4`'s host side are built on PD-53 to PD-55 since 28 October 2026, and wait for DQ-19 |
| Public event pages, ticketing, checkout | Not the first deliverable |
| Find your seat | B16 and D4 are built (`guest.seating`, 23 October 2026); where the table shows on the page is not designed yet |
| Agreeing outside a reply | The reply form asks for agreements (PD-52, since 28 October 2026). The standalone route and the ticket holders' agreements before check-in are not built |
| Email, Telegram and WhatsApp message designs | A separate surface; the backend owns the copy |
| Link-preview images | Invitation previews use `coverUrl` as it is. F24 concerns public events |
| An Aveline marketing site | Not requested |
