/**
 * What a fresh deployment needs before anyone can use it.
 *
 * Three things the platform cannot work without, none of which a customer can
 * create for themselves:
 *
 *   - **Design templates.** An invitation is built from one, so without a
 *     template `POST /events` returns an event with `invitation: null` and
 *     there is nothing to design.
 *   - **Default message copy.** Sending an invitation renders a template keyed
 *     by `(organizationId: null, key, channel)`. Without it the send fails
 *     with "template not found" partway through a guest list.
 *   - **Plans.** `GET /plans` is the pricing page and a subscription needs a
 *     plan to point at.
 *
 * Distinct from `seed.ts`, which creates a demo organization, an event and
 * guests with working links — useful locally, wrong on a real deployment. This
 * one creates **no organization, no user, no event and no guest**, and deletes
 * nothing.
 *
 * Idempotent, so it is safe to run on every deploy: everything is an upsert
 * that leaves an existing row's editable fields alone. A template someone has
 * tuned in production is not reverted by a redeploy.
 *
 * Lives under `src/` rather than beside `seed.ts` in `prisma/` for one
 * practical reason: it has to run on a real deployment, and the production
 * image has no `ts-node`. Compiling with the app means it ships as
 * `dist/seed-production.js` and runs with plain `node`.
 *
 *   npm run seed:production                 # locally, through ts-node
 *   node dist/seed-production.js            # on a deployment
 */
import { BlockType, BillingInterval, MessageChannel, PlanTier, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** The block set a template declares it can render. */
const FULL_BLOCK_SET: BlockType[] = [
  BlockType.HERO,
  BlockType.STORY,
  BlockType.COUNTDOWN,
  BlockType.VENUE,
  BlockType.MAP,
  BlockType.TIMELINE,
  BlockType.DRESS_CODE,
  BlockType.NOTES,
  BlockType.GALLERY,
  BlockType.RSVP,
  BlockType.CONTACT,
];

/** What each template can render, so customization stays safe. */
const DESIGN_TEMPLATES = [
  {
    key: 'classic',
    name: 'Classic',
    allowedFonts: ['Noto Serif Armenian', 'Cormorant Garamond', 'Inter'],
    palettes: [
      { name: 'ivory-gold', colors: ['#F3E9DD', '#C9A227', '#2E2A26'] },
      { name: 'sage', colors: ['#EDF1EA', '#7A8B74', '#2E2A26'] },
    ],
    supportedBlocks: FULL_BLOCK_SET,
    defaultTheme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' },
  },
  {
    key: 'minimal',
    name: 'Minimal',
    allowedFonts: ['Inter', 'Mardoto'],
    palettes: [
      { name: 'paper', colors: ['#FFFFFF', '#111111', '#8A8A8A'] },
      { name: 'ink', colors: ['#14161A', '#F5F5F5', '#9AA0A6'] },
    ],
    supportedBlocks: [
      BlockType.HERO,
      BlockType.VENUE,
      BlockType.TIMELINE,
      BlockType.RSVP,
      BlockType.CONTACT,
    ],
    defaultTheme: { bodyFont: 'Inter', palette: 'paper' },
  },
];

async function seedDesignTemplates() {
  for (const template of DESIGN_TEMPLATES) {
    await prisma.designTemplate.upsert({
      where: { key: template.key },
      // Left alone on purpose: a palette someone adjusted in production must
      // survive a redeploy.
      update: {},
      create: template,
    });
  }

  return DESIGN_TEMPLATES.length;
}

/**
 * Aveline's own copy, which every organization falls back to.
 *
 * `organizationId` is null, and Prisma cannot address a compound unique whose
 * component is null — the partial index from migration 20261004170000 is what
 * makes it unique. So this checks before inserting rather than upserting.
 */
/** Aveline's own copy, which every organization falls back to. */
const MESSAGE_COPY = [
  {
    key: 'invitation.send',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հրավեր {{hosts}}-ից', en: 'An invitation from {{hosts}}' },
    body: {
      hy: 'Հարգելի {{guestName}}, սիրով հրավիրում ենք Ձեզ {{eventTitle}}։\n\n{{link}}',
      en: 'Dear {{guestName}}, you are warmly invited to {{eventTitle}}.\n\n{{link}}',
    },
  },
  {
    key: 'rsvp.reminder',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հիշեցում՝ {{eventTitle}}', en: 'A gentle reminder: {{eventTitle}}' },
    body: {
      hy: '{{guestName}}, դեռ սպասում ենք Ձեր պատասխանին։\n\n{{link}}',
      en: '{{guestName}}, we are still hoping to hear from you.\n\n{{link}}',
    },
  },
  {
    key: 'thankyou.send',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Շնորհակալություն', en: 'Thank you' },
    body: {
      hy: '{{guestName}}, շնորհակալություն, որ մեզ հետ էիք։\n\n{{link}}',
      en: '{{guestName}}, thank you for being with us.\n\n{{link}}',
    },
  },
  {
    key: 'account.password-reset',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Գաղտնաբառի վերականգնում', en: 'Reset your password' },
    body: {
      hy: '{{name}}, սեղմեք հղումը գաղտնաբառը փոխելու համար։ Հղումը գործում է մեկ ժամ։\n\n{{link}}\n\nԵթե Դուք չեք խնդրել, անտեսեք այս նամակը։',
      en: '{{name}}, use this link to set a new password. It is valid for one hour.\n\n{{link}}\n\nIf you did not ask for this, ignore this email.',
    },
  },
  {
    key: 'account.verify-email',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Հաստատեք Ձեր էլ. հասցեն', en: 'Confirm your email address' },
    body: {
      hy: '{{name}}, հաստատեք Ձեր էլ. հասցեն՝\n\n{{link}}',
      en: '{{name}}, please confirm your email address:\n\n{{link}}',
    },
  },
  {
    key: 'organization.invite',
    channel: MessageChannel.EMAIL,
    subject: {
      hy: '{{organizationName}}-ը հրավիրում է Ձեզ',
      en: 'You have been invited to {{organizationName}}',
    },
    body: {
      hy: 'Ձեզ հրավիրել են միանալ {{organizationName}}-ին որպես {{role}}։\n\n{{link}}',
      en: 'You have been invited to join {{organizationName}} as {{role}}.\n\n{{link}}',
    },
  },
  {
    key: 'ticket.issued',
    channel: MessageChannel.EMAIL,
    subject: { hy: 'Ձեր տոմսերը', en: 'Your tickets' },
    body: {
      hy: 'Շնորհակալություն, {{buyerName}}։ Ձեր տոմսերը՝\n\n{{link}}',
      en: 'Thank you, {{buyerName}}. Your tickets:\n\n{{link}}',
    },
  },
];

async function seedMessageTemplates() {
  let created = 0;
  for (const template of MESSAGE_COPY) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { organizationId: null, key: template.key, channel: template.channel },
    });
    if (existing) continue;

    await prisma.messageTemplate.create({ data: { ...template, organizationId: null } });
    created += 1;
  }

  return created;
}

/**
 * Plans, with the entitlements from PRODUCT_SPEC §8.
 *
 * **Only the free tier is active.** The paid tiers' entitlements are decided
 * and are seeded so the shape is real, but their *prices* are an open decision
 * (§12) — and a plan with a made-up price is worse than no plan, because
 * `GET /plans` is the pricing page and someone could subscribe at it.
 * Activating one is a deliberate act: set `priceMinor` and `isActive`.
 */
/** The capability each tier grants, from PRODUCT_SPEC §8. */
const PLANS = [
  {
    key: 'invitation-free',
    name: 'Invitation',
    tier: PlanTier.INVITATION,
    priceMinor: 0n,
    interval: BillingInterval.PER_EVENT,
    maxEventsPerPeriod: 1,
    maxGuestsPerEvent: 150,
    maxLocales: 1,
    // Decided: three months on the free tier, indefinite on paid (§14.8).
    invitationLifetimeDays: 90,
    features: [] as string[],
    isActive: true,
    sortOrder: 0,
  },
  {
    key: 'managed',
    name: 'Managed',
    tier: PlanTier.MANAGED,
    priceMinor: 0n,
    interval: BillingInterval.PER_EVENT,
    maxEventsPerPeriod: 1,
    maxGuestsPerEvent: 400,
    maxLocales: 3,
    invitationLifetimeDays: null,
    features: ['seating', 'check-in', 'operations', 'vendor-briefs', 'thank-yous'],
    isActive: false,
    sortOrder: 1,
  },
  {
    key: 'production',
    name: 'Production',
    tier: PlanTier.PRODUCTION,
    priceMinor: 0n,
    interval: BillingInterval.PER_EVENT,
    maxEventsPerPeriod: 1,
    maxGuestsPerEvent: null,
    maxLocales: 99,
    invitationLifetimeDays: null,
    features: [
      'seating',
      'check-in',
      'operations',
      'vendor-briefs',
      'thank-yous',
      'custom-design',
      'coordinator',
    ],
    isActive: false,
    sortOrder: 2,
  },
  {
    key: 'planner-monthly',
    name: 'Planner',
    tier: PlanTier.PLANNER,
    priceMinor: 0n,
    interval: BillingInterval.MONTHLY,
    maxEventsPerPeriod: null,
    maxGuestsPerEvent: null,
    maxLocales: 99,
    invitationLifetimeDays: null,
    features: ['seating', 'check-in', 'operations', 'vendor-briefs', 'thank-yous'],
    isActive: false,
    sortOrder: 3,
  },
];

/**
 * Plans, with the entitlements from PRODUCT_SPEC §8.
 *
 * **Only the free tier is active.** The paid tiers' entitlements are decided
 * and are seeded so the shape is real, but their *prices* are an open decision
 * (§12) — and a plan with a made-up price is worse than no plan, because
 * `GET /plans` is the pricing page and someone could subscribe at it.
 * Activating one is a deliberate act: set `priceMinor` and `isActive`.
 */
async function seedPlans() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { key: plan.key },
      // A price set in production is not reverted by a redeploy.
      update: {},
      create: plan,
    });
  }

  return PLANS.length;
}

/**
 * The invoice counter for the current year.
 *
 * Seeded so the first invoice does not race: the counter is created on demand
 * by an upsert inside the issuing transaction, which is correct but means the
 * very first two concurrent issuers contend on an insert rather than a row.
 */
async function seedInvoiceCounter() {
  const series = String(new Date().getUTCFullYear());

  await prisma.invoiceCounter.upsert({
    where: { series },
    update: {},
    create: { series, next: 1 },
  });

  return series;
}

async function main() {
  const templates = await seedDesignTemplates();
  const copy = await seedMessageTemplates();
  const plans = await seedPlans();
  const series = await seedInvoiceCounter();

  console.log(`design templates: ${templates} ensured`);
  console.log(`message copy:     ${copy} created (existing left alone)`);
  console.log(`plans:            ${plans} ensured — only "invitation-free" is active`);
  console.log(`invoice series:   ${series}`);
  console.log('');
  console.log('No organization, user, event or guest was created.');
  console.log('Set a price and isActive on a paid plan before selling it.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
