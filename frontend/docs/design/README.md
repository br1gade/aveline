# Aveline design: where things stand

> **Status: snapshot, kept current.** Written on 18 October 2026.
>
> Start here. This file says what exists, what is decided, what is only a working default, and
> what must be answered before launch. The detail lives in the files it links to.

## 1. The state in brief

- **The brand brief is confirmed** by the designer (12 October 2026).
- **A complete design proposal exists:**
  - the guest invitation concept;
  - a written design system and its artifact on claude.ai;
  - 17 artboards;
  - a register of the placeholder photographs.
- **A visual review ran on 13 October:** 36 findings and 23 fixes. Three findings were corrected
  on 18 October, and all nine frontend-owned fixes were applied that day. The other fourteen wait
  for their owners.
- **The designer, product and the backend developer cannot answer for now.** Every open question
  therefore has a **provisional default** to build on. The defaults are cheap to reverse and kept
  apart from the decisions.
- **The frontend is being built** (from 18 October): the setup, the design tokens in code and the
  guest invitation with its reply flow exist, committed on `frontend/guest-invitation`. Since 23
  October the account pages and the app's first screens exist too, undesigned, on PD-39 and
  PD-40, and so do creating, opening and correcting an event, on PD-42 and PD-43. Since 24
  October an event's guest list and its import exist too, on PD-44 and PD-45, and since 25
  October its venues and its invitation's publishing and sending, on PD-46 to PD-49. On 28
  October the frontend followed the backend's `eb77cd4`: answering per venue, agreeing to the
  hosts' statements, typed or drawn, and changing how guests answer, on PD-50 to PD-55. See
  [ARCHITECTURE.md](../ARCHITECTURE.md).

## 2. This folder

| File | Holds |
|---|---|
| [README.md](README.md) | This snapshot: the state, the artifacts, the launch gates |
| [BRAND_BRIEF.md](BRAND_BRIEF.md) | The designer's brief, and verified facts about the logo, colours and fonts. **Confirmed only** |
| [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) | The register, with each kind kept apart: confirmed decisions, recommendations, assumptions, open questions and **provisional defaults** |
| [DESIGN_REVIEW.md](DESIGN_REVIEW.md) | The 13 October review: findings, fixes and their status, reply-state coverage |
| [GUEST_INVITATION.md](GUEST_INVITATION.md) | The guest invitation concept, drawn against the real API contract |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, typography, layout, components, states and accessibility |
| [REFERENCE_ANALYSIS.md](REFERENCE_ANALYSIS.md) | What the two reference websites do, in our own words and without naming them, and what we take from them |
| [PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md) | Every third-party photograph used in the mockups, and what replaces it |
| `research/` | **Local only, never committed** (the root `.gitignore` ignores it). Which sites the references are, and where each placeholder photograph came from. The repository keeps them anonymous |
| [assets/aveline-events-logo.png](assets/aveline-events-logo.png) | The logo, exactly as supplied |

## 3. The artifacts

All three are **private** on claude.ai: only their owner can open them until they are shared from
the page's Share menu. Share the canvas only within the team while it holds placeholder
photographs.

| Artifact | What it holds | Versions |
|---|---|---|
| [**Aveline Events**](https://claude.ai/artifact/6qY7NZvDFBmnF4XnKeDawo), design system | The brand book, `tokens.json` (Ivory and Bordeaux themes), 21 component previews with guidelines, the cover, the logo | First published on 13 October as `1791837143-7e7e`; an automatic save `1792311699-2b48` (AS-12). 18 October: `1792313839-12ae` (review fixes 4, 16, 19 and 23). **Current: `1792315900-1f30`** (the token `error-ink-hover`; `tokens.json` identical to `frontend/src/styles/tokens.json`) |
| [**Aveline Guest Invitation**](https://claude.ai/artifact/1UPc5z5stPwZNc5ntdU5s8), design canvas | 17 artboards ([GUEST_INVITATION §14](GUEST_INVITATION.md#14-the-artboards)), the design system's tokens, two notes, and the placeholder photographs | Published on 13 October as `1791838055-6cae`; an automatic save `1792311698-0d0b` (AS-12). 18 October: `1792313766-046c` (review fixes 1, 4, 8, 11, 16, 18 and 19; three rows moved down 300 px). **Current: `1792316472-b27f`** (fix 22: every board reads `tokens.css`, a copy of the app's generated file) |
| [**Aveline Design Review**](https://claude.ai/artifact/XGY21GRtMK6JFueWda51YM), page | The 13 October review as first published. No photographs | `1791906128-e0d4`. A snapshot: [DESIGN_REVIEW.md](DESIGN_REVIEW.md) supersedes it and corrects three findings |

**The specs are the written source of truth** for rules and behaviour. Token **values** now live
in `frontend/src/styles/tokens.json` and its generated `tokens.css`
([DESIGN_SYSTEM §13](DESIGN_SYSTEM.md#13-where-the-system-lives)). Where an artifact disagrees
with them, the spec and the code govern and the difference is a review finding
([DESIGN_DECISIONS §1.1](DESIGN_DECISIONS.md#11-while-questions-are-open), rule 4).

## 4. What is settled and what is not

| Kind | IDs | Where | State on 18 October |
|---|---|---|---|
| **Confirmed** | C-1 to C-22 | [DESIGN_DECISIONS §2](DESIGN_DECISIONS.md#2-confirmed) | Binding. C-21 and C-22 were verified in the backend code on 18 October |
| **Recommendations** | R-1 to R-33 | [DESIGN_DECISIONS §3](DESIGN_DECISIONS.md#3-recommendations) | None accepted yet |
| **Assumptions** | AS-1 to AS-12 | [DESIGN_DECISIONS §4](DESIGN_DECISIONS.md#4-assumptions) | Unverified |
| **Open questions** | DQ-1 to DQ-19 (designer), PQ-1 to PQ-11 (product and the frontend lead), BQ-1 to BQ-11 (backend) | [DESIGN_DECISIONS §5](DESIGN_DECISIONS.md#5-unresolved-questions) | 37 open. The review's Q10 was answered by the code (C-21); BQ-4, BQ-5, BQ-8 and BQ-9 by the backend on 23 October. DQ-13, DQ-14, DQ-15, PQ-10 and PQ-11 were added that day, DQ-16 on 24 October, DQ-17 on 25 October, DQ-18 and DQ-19 on 28 October |
| **Provisional defaults** | PD-1 to PD-55 | [DESIGN_DECISIONS §6](DESIGN_DECISIONS.md#6-provisional-defaults) | What to build on while the questions stay open. PD-13 closed on 18 October; PD-15, PD-16, PD-22 and PD-23 on 23 October, when the backend answered BQ-4, BQ-9, BQ-8 and BQ-5. PD-44 and PD-45 were added on 24 October, PD-46 to PD-49 on 25 October, PD-50 to PD-55 on 28 October, when the backend allowed signature questions again and PD-52 took PD-23's place |
| **Review findings** | VR-01 to VR-36; 23 fixes | [DESIGN_REVIEW.md](DESIGN_REVIEW.md) | 9 fixes done; 11 findings fixed and 1 partly; the rest open |

**How to tell them apart in practice:** a statement backed by a C- item is a decision. One backed
by a PD- item is a choice made so work can continue, and it will be revisited. Anything else in
the specs is a recommendation.

## 5. What can continue, and what waits

**Can continue on the defaults:**

- **Drawing** the missing states and sizes, following PD-37.
- **Building,** in progress since 18 October: the setup, the tokens, the components, the
  invitation renderer, the guest routes and the reply flow exist in `frontend/src/` (22 October),
  on the provisional defaults, and the account pages and the app's first screens since 23
  October, on PD-39 and PD-40. Creating, opening and correcting an event followed the same day,
  on PD-42 and PD-43, the guest list with its import on 24 October, on PD-44 and PD-45, and the
  venues, publishing and sending on 25 October, on PD-46 to PD-49. On 28 October, the backend's
  `eb77cd4`, on PD-50 to PD-55. Still to come: the end-to-end and accessibility tests against the
  real backend.
- **Keeping the registers current** as answers arrive (rule 7).

**Waits for its owner:**

- **The designer's fixes and decisions** (DQ-1 to DQ-19). Until then, work follows PD-1 to PD-14,
  PD-27 to PD-39, PD-41, PD-42, PD-44 to PD-48 and PD-50 to PD-55.
- **Product decisions** (PQ-1 to PQ-11), on PD-17 to PD-20, PD-40 and PD-43. PD-15 and PD-16
  closed on 23 October.
- **Backend changes** (BQ-1 to BQ-3, BQ-6, BQ-7, BQ-10, BQ-11), on PD-21 and PD-24 to PD-26.
  PD-22 and PD-23 closed on 23 October. The publish blockers' codes (FR-32), on PD-49; the codes
  for the guest, venue and expired-send refusals (FR-28), on the text stand-ins in PD-54 and PD-55.
  - The frontend never changes backend code.
  - A need becomes a backend question, not a lasting workaround
    ([DESIGN_DECISIONS §1.1](DESIGN_DECISIONS.md#11-while-questions-are-open), rule 5).

## 6. Launch gates

A default can carry development and review. It cannot carry a real guest. Before the first real
invitation is sent:

| Gate | Why | Register |
|---|---|---|
| Every placeholder photograph is replaced | Third-party images, not licensed to Aveline | C-10, PQ-7, [PLACEHOLDER_IMAGES.md](PLACEHOLDER_IMAGES.md) |
| Native readers have checked the Armenian and Russian copy | Every string in both languages is a draft | DQ-9, PD-9 |
| The designer has approved or corrected the visual system, the account, event, guest-list, venue, invitation and attendance pages, and the reply form's venues and agreements, included | Unapproved recommendations shown to guests and hosts would become the brand by default | DQ-2, DQ-6, DQ-7, DQ-10, DQ-12, DQ-13, DQ-14, DQ-15, DQ-16, DQ-17, DQ-18, DQ-19 |
| Product has set the default dietary and drink choices offered to hosts, and which questions are on by default | Hosts now choose per invitation, but a host who changes nothing gets free text, which the catering sheet cannot count | PQ-1 to PQ-3 |
| ~~A required SIGNATURE question can no longer block attending guests~~ **Met 23 October 2026:** the backend refuses to create one (B69). It opened again with the backend's `eb77cd4`, which allows them again, and **was met again on 28 October 2026:** the reply form asks for the agreement, typed or drawn, for everyone coming ([BACKEND_REQUESTS §5](../BACKEND_REQUESTS.md#5-the-pull-of-eb77cd4)) | Those guests could not reply at all | BQ-5 (answered), PD-52 |
| The palette stand-in is replaced, or accepted in writing for launch | No permanent client workaround | BQ-1, BQ-2, PD-21 |
| The review's P1 and P2 fixes are applied (fixes 1, 4, 8 and 11 are done; the reply line was corrected on 18 October) | Rendering and accessibility problems | [DESIGN_REVIEW §5](DESIGN_REVIEW.md#5-fixes) |

These belong in `docs/GOING_LIVE.md` as well. That file is shared, so they go in through the
shared-document process, with the backend developer's review. This work did not edit it.

## 7. When an answer arrives

1. Record it in [DESIGN_DECISIONS §2](DESIGN_DECISIONS.md#2-confirmed), with the date and who
   decided.
2. Mark the question closed, and the provisional default that stood in for it.
3. Follow the default's "If the answer differs" column.
4. Update the governing spec, the artifact and, for a review finding,
   [DESIGN_REVIEW.md](DESIGN_REVIEW.md), in the same change.
5. Update this file's counts in §4.

## 8. Not yet done

- **Fourteen review fixes are not applied:** the ones owned by the designer, product or a native
  reader.
- **The published review page is not corrected.** It stays a snapshot.
- **The backend questions are not yet sent.** They are listed in
  [BACKEND_REQUESTS.md](../BACKEND_REQUESTS.md) (FR-1 to FR-41, BQ-1 to BQ-11), and
  [DESIGN_DECISIONS §5](DESIGN_DECISIONS.md#5-unresolved-questions) still holds their reasoning.
- **The launch gates are not yet in `docs/GOING_LIVE.md`** (§6).
- **The guest, account, event, guest-list, venue, invitation and attendance pages have not run against the real backend.** They were
  checked against a mock of the API (those of 28 October by unit and component tests only, not yet
  walked through in a browser); the end-to-end and accessibility tests wait for the local backend
  ([ARCHITECTURE §12](../ARCHITECTURE.md#12-not-yet-built)).
- **French is not built.** The pilot asks for it in the host and guest interfaces
  (`docs/PILOT_IMPLEMENTATION_PLAN.md`); a French reader would join the native-reader gate.
