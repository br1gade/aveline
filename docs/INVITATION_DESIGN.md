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

Adding a template is an INSERT and an asset upload. It is not a deployment.

### Theme resolution

An invitation's `theme` is layered over its template's `defaultTheme`:

```
effective theme = { ...template.defaultTheme, ...invitation.theme }
```

A partially configured invitation therefore always has a complete token set.
This happens in `InvitationsService.getPublicInvitation`.

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
| `variant` | Template-provided layout, e.g. `split`, `stacked`, `full-bleed` |
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
| `PHOTO` | Every uploaded image — hero, gallery, story |
| `COVER` | Reserved; uploads are recorded as `PHOTO` |
| `SIGNATURE` | A captured signature |
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
text in the wrong language is not accessible.

`sizeBytes` is stored so upload limits can be enforced and per-event storage
reported, which matters for pricing tiers.

---

## 4. Input requests

The invitation asks the guest for things in two ways.

**Well-known questions** are columns on `Rsvp`: attendance, attribution,
dietary, drink preference, song request, message. They are columns because
every operational view is a query over them (see
[PRODUCT_SPEC.md](PRODUCT_SPEC.md) §6).

**Host-authored questions** are `RsvpQuestion` rows with translated prompts and
options:

| `QuestionType` | Captures |
|---|---|
| `TEXT`, `LONG_TEXT` | Free text |
| `SINGLE_CHOICE`, `MULTI_CHOICE` | Selection from translated options |
| `BOOLEAN` | Yes/no |
| `SIGNATURE` | A drawn signature, stored as a `MediaAsset` |

The design rule: **a question with no downstream consumer does not get asked.**
Collecting data nobody reads is how the rest of the category ends up with an
inbox full of unusable form notifications.

### Signatures

Two distinct uses, both supported:

- **`BlockType.SIGNATURE`** — the hosts' own signature or monogram rendered on
  the invitation. Decorative.
- **`QuestionType.SIGNATURE`** — the guest signs something. Stored on
  `Rsvp.signatureAssetId`. Real uses: photo-and-video consent, a corporate
  event waiver, acknowledging a venue's conditions.

The second is why signatures are modelled at all. It is not needed for a
family wedding; it is needed the first time a corporate client asks.

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
`supportedBlocks` before any write — so a rejected arrangement changes
nothing and the error names the offending block.

**Uploads.** `POST /events/:eventId/media` accepts multipart, enforces a MIME
allowlist and a 10 MB ceiling, and records a `MediaAsset` with its
`sizeBytes`. Files are stored under a generated key, never the uploaded
filename.

## 7. Not yet built

1. **Image processing** — resizing, format conversion, thumbnails. One
   original is stored as uploaded.
2. **Alt text.** `MediaAsset.altText` is returned per locale, but no endpoint
   writes it, so it is always empty.
3. **Block creation outside the arrangement call.** Which blocks exist is
   decided there; there is no way to add one while editing its content.
4. **Reordering custom RSVP questions.** They can be added, changed and
   removed, but a question's `sortOrder` is assigned on creation and nothing
   changes it.
5. **Signature capture** on the client and its asset write path.
6. **Template preview** rendering.

Theme validation, block content, template switching, RSVP questions and venue
CRUD are built — see [API.md](API.md) §6.
