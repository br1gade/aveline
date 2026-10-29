# Invitation Design

How an invitation is composed, what a host may change, and who is allowed to
change it.

---

## 1. Templates are data, not code branches

`DesignTemplate` is a row, not a React component selected by a `switch`. Each
template declares what it can render correctly:

| Field | Purpose |
|---|---|
| `key`, `name` | Identity, e.g. `classic` |
| `allowedFonts` | Font families this template typesets correctly |
| `palettes` | Named colour sets the host may choose from |
| `supportedBlocks` | Block types this template knows how to render |
| `defaultTheme` | Tokens applied when an invitation is created |

This is what makes "customization by qualified users" safe. A host picks from
`allowedFonts`; they cannot select a font with no Armenian glyphs and silently
break their own invitation. The template guarantees that any permitted
combination still renders.

Adding a template uses platform-controlled draft/publication. A new renderer capability requires a reviewed deployment; authoring data cannot extend renderer code.

### Theme resolution

An invitation's `theme` is layered over its template's `defaultTheme`:

```
effective theme = { ...template.defaultTheme, ...invitation.theme }
```

A partially configured invitation therefore always has a complete token set.
Live pages and preview payloads share `buildInvitationContent`.

---

## 2. Blocks and arrangement

An invitation is an ordered list of `InvitationBlock` rows. The host arranges
the page by reordering, disabling, and choosing variants — never by editing
layout code.

| Field | Controls |
|---|---|
| `type` | Which block: `HERO`, `STORY`, `VENUE`, `RSVP`, `SIGNATURE`, … |
| `sortOrder` | Position on the page |
| `enabled` | Whether it renders at all |
| `variant` | A layout the template offers for this block (`DesignTemplate.blockVariants`), e.g. `split`, `stacked`, `full-bleed`; `null` is the default |
| `content` | Block-local copy, translated per locale |
| `settings` | Non-translated options, e.g. palette swatches |
| `assetIds` | Ordered media shown by this block |

`(invitationId, type)` is unique: one hero, one RSVP form, one countdown.

### Data-bound blocks carry no copy of event data

`VENUE`, `MAP`, `TIMELINE` and `COUNTDOWN` store **nothing** about the event.
They are hydrated at render time from the `Event` itself. Correcting a venue
address is one UPDATE, not an edit of every block that mentions it.

This is why unlimited free revisions are economically trivial for us and
rationed by everyone else: a revision is usually a single field change, not a
re-layout.

---

## 3. Media

`MediaAsset` holds every uploaded image, **scoped to an event**. Deleting an
event reclaims its storage, and no asset is reachable from an unrelated
invitation.

| Kind | Used for |
|---|---|
| `PHOTO` | Default image kind — hero, gallery, story |
| `COVER` | Explicit cover image upload |
| `SIGNATURE` | Reserved for private guest acknowledgement capture |
| `LOGO` | Corporate events |
| `AUDIO` | Background music |

**A block shows media through its `assetIds`, in order**, and the public
invitation returns each block's media with its URL. The `MUSIC` block accepts
audio only; every other block accepts images only, checked when media is
attached so the mistake is reported to the host rather than rendered to the
guests.

**The cover and the music are not stored separately.** The cover is the
`HERO` block's first photo; the music is the `MUSIC` block's audio, and
disabling that block silences the page. One place to set each means the two
cannot disagree.

`altText` is translated per locale, the same as block content — accessibility
text in the wrong language is not accessible. It is written one language at a
time with `PATCH /events/:eventId/media/:assetId`.

An upload can be removed only while no block shows it — the page guests
already hold would otherwise show a broken image — and removing it deletes the
file too.

`sizeBytes` is stored so upload limits can be enforced and per-event storage
reported, which matters for pricing tiers.

---

## 4. Input requests

The invitation asks the guest for things in two ways.

**Well-known questions** feed `Rsvp` and the versioned attendance model: attendance, attribution,
dietary, drink preference, song request, message. They are columns because
every operational view is a query over them (see
[PRODUCT_SPEC.md](PRODUCT_SPEC.md) §6). Each except attendance can be switched
off per invitation, and dietary and drink can offer fixed choices stored by
key, so every language counts as one answer (`Invitation.rsvpFields`,
`rsvp/rsvp-fields.ts`).

**Host-authored questions** are `RsvpQuestion` rows with translated prompts and
options:

| `QuestionType` | Captures |
|---|---|
| `TEXT`, `LONG_TEXT` | Free text |
| `SINGLE_CHOICE`, `MULTI_CHOICE` | Selection from translated options |
| `BOOLEAN` | Yes/no |
| `SIGNATURE` | Typed or drawn versioned acknowledgement in private guest storage |

**A choice is stored by its position in the option list**, not its text. The
options are translated and each guest sees them in their own language, so
position is what lets every language count as one answer — so every language
must list the same number of options, and once a guest or a pending ticket checkout has answered, options
can be reworded or added at the end but never removed or reordered, and the
type cannot change (decided 10 October 2026). Answers are checked against
their question's type and options when submitted, and a `required` question
binds every guest who is attending, plus-ones included.

Ticket checkout locks question definitions before validating the complete roster.
Pending and archived checkout answers also protect questions from deletion or
shape changes, so later payment settlement cannot lose an answer or reference a
deleted question. Host draft `answerCount` still counts live RSVP answers only; deletion/shape guards also count acknowledgement history.

The design rule: **a question with no downstream consumer does not get asked.**
Collecting data nobody reads is how the rest of the category ends up with an
inbox full of unusable form notifications.

### Signatures

Two distinct uses:

- **`BlockType.SIGNATURE`** — the hosts' own signature or monogram rendered on
  the invitation. Decorative.
- **`QuestionType.SIGNATURE`** — typed or drawn guest acknowledgement, stored as
  an immutable `GuestAcknowledgement` per statement version and subject. A
  representative may explicitly acknowledge selected members of their household;
  the actual signer stays distinct. Multiple questions have separate records.
  Private drawn uploads use `GuestMedia`, processed by a dedicated worker, never
  the public media library. Required current versions gate affected attending
  RSVPs and check-in. Ticket buyers cannot sign for attendees via order access;
  each attendee uses their personal invitation before admission. Wording edits
  preserve old records and require fresh acknowledgement. The nullable legacy
  `Rsvp.signatureAssetId` is retained for compatibility and receives no new writes.

The invited-guest gallery also uses `GuestMedia`. Hosts must approve a processed
photo before other guests can see it; the uploader sees pending/rejected states
and may remove their own photo after approval. Limits are 20 photos/guest,
1,000/event, 2 GiB/event including derived files and 10 MiB/upload. The worker
strips metadata, rejects animation and emits private variants. Host data remains
when guest access expires. Privacy erasure revokes files immediately and queues
durable deletion. Details: [API.md](API.md) and
[worker/retention rules](../backend/docs/GUEST_CONTRIBUTIONS.md).

---

## 5. Who may design

Governed by [ACCESS_CONTROL.md](ACCESS_CONTROL.md). The `invitation:design`
permission is held by platform `ADMIN` and `SUPPORT`, organization `OWNER` and
`MANAGER`, and event `OWNER`, `COORDINATOR` and `DESIGNER`.

`DESIGNER` exists precisely for this surface: a freelance designer can restyle
the invitation while being denied `guest:contact:read`, `operations:read` and
`vendor:fee:read`. They shape the page without reading four hundred phone
numbers.

---

## 6. What is built

**Arrangement.** `PATCH /invitations/:slug/arrangement` reorders, toggles and
re-variants every block in one transaction, validated against the template's
`supportedBlocks` and `blockVariants` before any write — so a rejected arrangement changes
nothing and the error names the offending block.

**Uploads.** `POST /events/:eventId/media` accepts multipart, enforces a MIME
allowlist and a 10 MB ceiling, and records a `MediaAsset` with its
`sizeBytes`. Files are stored under a generated key, never the uploaded
filename. Optional `kind` is allowlisted to PHOTO/COVER/LOGO/AUDIO, defaults
by MIME type and must agree with the type. SIGNATURE/DOCUMENT cannot enter the
public upload route. Listing hero/share selections use same-event images and
also prevent deletion while selected.

**Question order.** `PATCH /invitations/:slug/question-order` supplies every
stable question ID in the desired order, plus `expectedOrder` from the editor's
read. Conflicting additions/removals/reorders return 409. Reordering preserves
answers, required flags and option positions; invalid orders change nothing.

**Previews.** Authorized catalogue and event-template preview routes return
renderer payloads built by the same serializer as a live invitation. Catalogue
content is synthetic in en/ru/fr/hy; event previews use only public-facing event
content, including drafts, with no guest/household data. Target template support,
variants, theme defaults and locale rules match live behavior. No state, cache
or analytics are written and no RSVP can be collected through a preview route.
The frontend uses its actual invitation renderer and disables submission;
visual/browser acceptance remains pending.

### Page lifetime and freshness

First publication captures 90 days after event end/start for the free fallback,
or an eligible subscription's finite/indefinite plan lifetime. Date edits
recompute finite expiry; reopening does not reset it. Expired guest pages and
contribution access close while host drafts/data/media remain available.
Previously published rows preserve their deadlines as LEGACY pending review.
Shared and personal cached payloads use committed database revisions and live
access checks, so design/venue/guest edits and erasure cannot revive stale pages
after Redis recovers. See [API.md](API.md#invitation-lifetime-and-expired-access).

## 7. Not yet built

1. **Cropping and focal points.** Photos get smaller WebP copies by width;
   nothing crops them to a shape or records where the subject is.
2. **Block creation outside the arrangement call.** Which blocks exist is
   decided there; there is no way to add one while editing its content.
3. **Frontend signature capture and moderated gallery screens**, including four-language acceptance. Backend private storage, versioned records and moderation are implemented.
4. **Frontend template preview rendering and visual acceptance.** The backend
   renderer payloads are built; the frontend still has to render them.

Theme validation, block content, template switching, RSVP questions and venue
CRUD are built — see [API.md](API.md) §6.

## Immutable versions and platform authoring (F44)

Invitation creation and explicit switching pin immutable template rendering inputs.
Migration preserves every legacy rendering value exactly; legacy provenance makes
no renderer-acceptance claim. Publishing or retiring a template changes future
selection only. Existing draft/live/closed pins, invitation lifetime, attendance,
acknowledgement statements and captured exports are unchanged.

ADMIN creates shared identities or organization-private opaque identities and may
assign active SUPPORT to drafts. Assignment grants no organization/event membership.
Customer OWNER/DESIGNER remain invitation editors, not template authors. Draft
merges require expected revisions; a single open draft and immutable versions are
enforced by database constraints. Four-locale synthetic JSON previews use the
same serializer as public pages and are explicitly payload-only until a reviewed
capability release is deployed. Publication allocates version, immutable facts,
active pointer, frozen draft, audit and dedupe receipt in one transaction.

New publication is closed in production: the approved capability registry is
empty. The backend ceiling comes from actual seeds, whose variants/fonts/themes
are not evidence of current frontend handling. The deployed manifest must pass
intersection validation plus actual en/ru/fr/hy, named palette role/font, inert
preview and mobile/desktop acceptance. No ADMIN-editable capability whitelist or
renderer code is accepted. See [the capability contract](contracts/invitation-renderer-capabilities/README.md).

Existing invitations adopt an exact version only through requester-bound expiring
preview and confirmation with source pin/hash/designRevision and UUID dedupe key.
Same-key legacy requests never auto-upgrade. Unsupported blocks keep copy while
being disabled; unsupported variants reset to null; event artwork remains an
override. Retired pins continue to render and edit.

Private raster uploads use their own durable object ledger and bounded background
sanitizer; they never use public MediaAsset source URLs. File reads check current
staff assignment before and after IO. Metadata is stripped; SVG, animation,
multiframe files and oversized/decompression-heavy input are refused. Unreferenced
objects use durable tombstones/leases; referenced immutable bytes are retained.

Default artwork uses normalized same-template slot references and immutable hashes.
A preview reserves event-private copies and returns processing state until the
worker finishes; confirmation atomically binds ready copies and the target pin.
Initial selection reserves only database intents, leaves the invitation DRAFT,
and blocks publishing until binding. Late workers cannot bind a changed pin.
Guest/editor file reads recheck live capabilities and pin after storage reads;
shared caches contain internal descriptors projected to request-specific paths
only after retrieval. Deleting an event retires its copies, preserving reusable art.

Not yet accepted: deployed frontend capability/visual evidence and production
private-storage/worker isolation/load evidence. The backend materialization path is
implemented and exercised with synthetic trusted capabilities; production slots
remain closed until the actual reviewed renderer release exists.
