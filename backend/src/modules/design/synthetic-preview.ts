import { BlockType } from '@prisma/client';
import { ContentTemplate, InvitationContent } from '../invitations/invitation-content';

const SAMPLE_COPY = {
  en: { title: 'A celebration together', hosts: 'Alex & Sam', venue: 'Garden Hall', address: '12 Garden Lane', welcome: 'Join us for a special day', meal: 'Celebration dinner' },
  ru: { title: 'Праздник вместе', hosts: 'Алекс и Сэм', venue: 'Садовый зал', address: 'Садовая улица, 12', welcome: 'Приглашаем вас на особенный день', meal: 'Праздничный ужин' },
  fr: { title: 'Une fête ensemble', hosts: 'Alex et Sam', venue: 'Salle du jardin', address: '12, allée du Jardin', welcome: 'Rejoignez-nous pour une journée spéciale', meal: 'Dîner de fête' },
  hy: { title: 'Տոնենք միասին', hosts: 'Ալեքս և Սեմ', venue: 'Այգու սրահ', address: 'Այգու փողոց 12', welcome: 'Միացեք մեզ այս յուրահատուկ օրը', meal: 'Տոնական ընթրիք' },
};

/** Synthetic renderer input contains no fields copied from a customer's event. */
export function syntheticPreview(template: ContentTemplate): InvitationContent {
  const translations = Object.fromEntries(Object.entries(SAMPLE_COPY).map(([locale, copy]) => [locale, { title: copy.title, hostsLabel: copy.hosts }]));
  const content = Object.fromEntries(Object.entries(SAMPLE_COPY).map(([locale, copy]) => [locale, { title: copy.title, subtitle: copy.welcome, text: copy.welcome }]));
  const types = template.supportedBlocks.length ? template.supportedBlocks : [BlockType.HERO, BlockType.VENUE, BlockType.TIMELINE, BlockType.RSVP];
  return {
    slug: 'template-preview', status: 'DRAFT', expiresAt: null, theme: {}, rsvpFields: {}, template, media: new Map(), questions: [],
    blocks: types.map((type, sortOrder) => ({ type, sortOrder, variant: null, content, settings: {}, assetIds: [] })),
    event: {
      type: 'WEDDING', title: SAMPLE_COPY.en.title, hostsLabel: SAMPLE_COPY.en.hosts,
      startsAt: new Date('2030-06-15T14:00:00Z'), endsAt: new Date('2030-06-15T20:00:00Z'), timezone: 'Asia/Yerevan',
      locales: Object.keys(SAMPLE_COPY), defaultLocale: 'en', translations, sideALabel: null, sideBLabel: null,
      venues: [{ id: 'preview-venue', role: 'RECEPTION', name: SAMPLE_COPY.en.venue, address: SAMPLE_COPY.en.address,
        translations: Object.fromEntries(Object.entries(SAMPLE_COPY).map(([locale, copy]) => [locale, { name: copy.venue, address: copy.address }])),
        latitude: null, longitude: null, mapUrl: null, arriveAt: new Date('2030-06-15T14:00:00Z'),
      }],
      timeline: [{ label: Object.fromEntries(Object.entries(SAMPLE_COPY).map(([locale, copy]) => [locale, copy.meal])), occursAt: new Date('2030-06-15T15:00:00Z'), venueId: 'preview-venue' }],
    },
  };
}
