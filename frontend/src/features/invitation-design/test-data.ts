import { http, HttpResponse } from 'msw';
import type { SetupServer } from 'msw/node';

import type { EventDetail } from '@/features/events';

import type { DesignWire, LibraryItemWire, TemplateWire } from './types';

/**
 * Test data for the designer, shaped like the backend's answers (`draft-reader.service.ts`,
 * `design.service.ts`, `media.service.ts`) and its demo event. Every name is fictional, and no
 * capability token appears: none of these answers carries one.
 */

export const ORIGIN = 'http://api.test';
export const API = `${ORIGIN}/api/v1`;
export const SLUG = 'anna-davit-3f8a1c20';

export const EVENT: EventDetail = {
  id: 'e1',
  title: 'The wedding of Anna and Davit',
  type: 'WEDDING',
  hostsLabel: 'Anna & Davit',
  startsAt: '2027-06-12T11:00:00.000Z',
  endsAt: null,
  timezone: 'Asia/Yerevan',
  locales: ['hy', 'en'],
  defaultLocale: 'hy',
  sideALabel: null,
  sideBLabel: null,
  invitation: { slug: SLUG, status: 'DRAFT' },
};

const CLASSIC_BLOCKS = [
  'HERO',
  'STORY',
  'VENUE',
  'DRESS_CODE',
  'GALLERY',
  'RSVP',
  'CONTACT',
  'CHAT',
];

export const CLASSIC: TemplateWire = {
  key: 'classic',
  name: 'Classic',
  allowedFonts: ['Noto Serif Armenian', 'Cormorant Garamond', 'Inter'],
  palettes: [
    { name: 'ivory-gold', colors: ['#F3E9DD', '#C9A227', '#2E2A26'] },
    { name: 'sage', colors: ['#EDF1EA', '#7A8B74', '#2E2A26'] },
  ],
  supportedBlocks: CLASSIC_BLOCKS,
  blockVariants: Object.fromEntries(
    CLASSIC_BLOCKS.map((type) => [type, ['full-bleed', 'split', 'stacked']]),
  ),
  defaultTheme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' },
};

export const MINIMAL: TemplateWire = {
  key: 'minimal',
  name: 'Minimal',
  allowedFonts: ['Inter', 'Mardoto'],
  palettes: [{ name: 'paper', colors: ['#FFFFFF', '#111111', '#8A8A8A'] }],
  supportedBlocks: ['HERO', 'VENUE', 'RSVP', 'CONTACT'],
  blockVariants: { HERO: ['split'], RSVP: ['split', 'stacked'] },
  defaultTheme: { bodyFont: 'Inter', palette: 'paper' },
};

export const RSVP_BLOCKER = 'Turn on the RSVP block, or guests will have no way to answer';

const BLOCKS: DesignWire['blocks'] = [
  {
    type: 'HERO',
    enabled: true,
    variant: 'split',
    content: { hy: { title: 'Աննա և Դավիթ', kicker: 'kept' }, en: { title: 'Anna & Davit' } },
    settings: {},
    assetIds: [],
    media: [],
  },
  {
    type: 'STORY',
    enabled: true,
    variant: null,
    content: { hy: { body: 'Ուրախ կլինենք' } },
    settings: {},
    assetIds: [],
    media: [],
  },
  {
    type: 'VENUE',
    enabled: true,
    variant: null,
    content: {},
    settings: {},
    assetIds: [],
    media: [],
  },
  {
    type: 'RSVP',
    enabled: false,
    variant: null,
    content: {},
    settings: {},
    assetIds: [],
    media: [],
  },
];

const QUESTIONS: DesignWire['questions'] = [
  {
    id: 'q1',
    type: 'SINGLE_CHOICE',
    required: true,
    prompt: { hy: 'Ինչպե՞ս եք հասնելու', en: 'How will you be arriving?' },
    options: { hy: ['Մեքենայով', 'Տրանսֆերով'], en: ['Own car', 'Shuttle'] },
    answerCount: 12,
  },
  {
    id: 'q2',
    type: 'TEXT',
    required: false,
    prompt: { en: 'Anything we should know?' },
    options: {},
    answerCount: 0,
  },
];

/** A draft in Classic, with the reply section switched off and two questions, one answered. */
export function designWire(fields: Partial<DesignWire> = {}): DesignWire {
  return {
    slug: SLUG,
    status: 'DRAFT',
    event: {
      id: 'e1',
      title: EVENT.title,
      locales: ['hy', 'en'],
      defaultLocale: 'hy',
      timezone: 'Asia/Yerevan',
    },
    template: CLASSIC,
    theme: { palette: 'sage' },
    effectiveTheme: { bodyFont: 'Noto Serif Armenian', palette: 'sage' },
    rsvpFields: {},
    blocks: structuredClone(BLOCKS),
    questions: structuredClone(QUESTIONS),
    publishBlockers: [RSVP_BLOCKER],
    ...fields,
  };
}

/** A preview as the backend builds it: a guest page's shape, with no guest, collecting nothing. */
export function previewWire(locale: string, previewSource: 'EVENT' | 'SYNTHETIC' = 'EVENT') {
  return {
    slug: SLUG,
    isAcceptingResponses: false,
    isPreview: true,
    previewSource,
    template: 'classic',
    theme: { palette: 'sage' },
    allowedFonts: ['Noto Serif Armenian'],
    musicUrl: null,
    coverUrl: null,
    locale,
    availableLocales: ['hy', 'en'],
    event: {
      type: 'WEDDING',
      title: EVENT.title,
      hosts: 'Anna & Davit',
      startsAt: '2027-06-12T11:00:00.000Z',
      endsAt: null,
      timezone: 'Asia/Yerevan',
      sides: { a: null, b: null },
    },
    guest: null,
    blocks: [
      {
        type: 'HERO',
        sortOrder: 0,
        variant: null,
        settings: {},
        content: {},
        media: [],
        data: null,
      },
      {
        type: 'RSVP',
        sortOrder: 1,
        variant: null,
        settings: {},
        content: {},
        media: [],
        data: null,
      },
    ],
    rsvpQuestions: [],
  };
}

export function libraryWire(): LibraryItemWire[] {
  return [
    {
      id: 'm2',
      url: 'https://media.example.com/garden.jpg',
      kind: 'PHOTO',
      mimeType: 'image/jpeg',
      sizeBytes: 2_400_000,
      altText: { en: 'The garden' },
      width: 1600,
      height: 1200,
      variants: [{ width: 480, height: 360, url: 'https://media.example.com/garden-480.webp' }],
      createdAt: '2026-10-28T10:00:00.000Z',
      usedBy: [],
      listingUses: [],
    },
    {
      id: 'm1',
      url: 'https://media.example.com/couple.jpg',
      kind: 'PHOTO',
      mimeType: 'image/jpeg',
      sizeBytes: 900_000,
      altText: { hy: 'Աննան և Դավիթը' },
      createdAt: '2026-10-27T10:00:00.000Z',
      usedBy: ['HERO'],
      listingUses: [],
    },
    {
      id: 'm3',
      url: 'https://media.example.com/song.mp3',
      kind: 'AUDIO',
      mimeType: 'audio/mpeg',
      sizeBytes: 4_000_000,
      altText: {},
      createdAt: '2026-10-26T10:00:00.000Z',
      usedBy: [],
      listingUses: [],
    },
  ];
}

interface Served {
  design?: DesignWire;
  templates?: TemplateWire[];
  library?: LibraryItemWire[];
  event?: EventDetail;
}

/** The reads every design page makes; each counted, so a test can see a reload. */
export function serveDesign(server: SetupServer, served: Served = {}) {
  const reads = { design: 0 };
  server.use(
    http.get(`${API}/events/e1`, () => HttpResponse.json(served.event ?? EVENT)),
    http.get(`${API}/invitations/${SLUG}/design`, () => {
      reads.design += 1;
      return HttpResponse.json(served.design ?? designWire());
    }),
    http.get(`${API}/events/e1/design-templates`, () =>
      HttpResponse.json(served.templates ?? [CLASSIC, MINIMAL]),
    ),
    http.get(`${API}/events/e1/media`, () => HttpResponse.json(served.library ?? libraryWire())),
  );
  return reads;
}

/** Records each write's JSON body (or "deleted"), and answers with `response`. */
export function answer(
  server: SetupServer,
  method: 'post' | 'patch' | 'delete',
  path: string,
  response: () => Response = () => HttpResponse.json({}),
) {
  const received: unknown[] = [];
  server.use(
    http[method](`${API}${path}`, async ({ request }) => {
      received.push(method === 'delete' ? 'deleted' : await request.json());
      return response();
    }),
  );
  return received;
}

export const refusal =
  (status: number, message: string | string[] = 'refused') =>
  () =>
    HttpResponse.json({ statusCode: status, message, requestId: 'req-1' }, { status });
