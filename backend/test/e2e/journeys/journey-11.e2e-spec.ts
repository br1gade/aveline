import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockType, EventType, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { attendeeRoster } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

interface ListedGuest { id: string; firstName: string; rsvpStatus: string; email?: string; phone?: string; token?: string }
interface Booking { id: string; feeMinor?: string; briefToken?: string; vendor: { name: string } }

/** The capability token an invite email carries. */
function tokenIn(body: string): string {
  const match = /[?&]token=([^&\s"'<>]+)/.exec(body);
  if (!match) throw new Error(`No invite link in message: ${body}`);
  return decodeURIComponent(match[1]);
}

/**
 * Journey 11: a team. The event owner invites a designer (new to Aveline)
 * and a viewer (who already has an account) by email; each accepts from the
 * link in their email and signs in, then walks every module to find exactly
 * their slice. A role change applies on the next request and removal cuts
 * access. Organization-level invites (MANAGER, MEMBER) are walked the same
 * way. Every step is HTTP through the real AppModule; only the outbox
 * dispatch is driven in-process, as the scheduler would.
 */
describe('Journey 11: a team where each role sees exactly its slice (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;
  const as = (authorization: string) => ({
    get: (path: string) => http().get(api(path)).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(api(path)).set('Authorization', authorization).send(body),
    put: (path: string, body: object) => http().put(api(path)).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(api(path)).set('Authorization', authorization).send(body),
    delete: (path: string) => http().delete(api(path)).set('Authorization', authorization),
  });
  type Caller = ReturnType<typeof as>;
  /** A refusal, and the reason it names: the permission the guard found missing. */
  const refusal = async (pending: request.Test) => {
    const { status, body } = await pending;
    return { status, message: body.message as string };
  };
  const mayNot = (permission: string) => ({ status: 403, message: `This account may not ${permission}` });
  /** Door codes and buyers' emails: a manifest needs contact permission (docs/API.md, exports). */
  const manifestRefused = { status: 403, message: 'A ticket manifest export needs guest:contact:read' };

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // The outbox is driven in-process; a wall-clock cron would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.designTemplate.create({
      data: {
        key: 'journey-11', name: 'Journey 11', allowedFonts: ['Inter'],
        palettes: [{ name: 'ivory', colors: ['#fffaf0', '#b8860b'] }, { name: 'sage', colors: ['#f0f5ee', '#5b7553'] }],
        supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.RSVP],
      },
    });
    await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
  });

  afterAll(async () => {
    if (app) {
      const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
      if (email instanceof SmtpTransport) email.close();
      await app.close();
    }
    await disconnectTestDatabase();
  });

  const signIn = async (email: string, password: string) => {
    const { body } = await http().post(api('/auth/login')).send({ email, password }).expect(201);
    return as(`Bearer ${body.accessToken as string}`);
  };

  /** Sends what is due and returns the token in the email that went to `address`. */
  const emailedToken = async (templateKey: string, address: string) => {
    await app.get(CommunicationsService).dispatchDue();
    const message = await prisma.message.findFirstOrThrow({ where: { templateKey, toAddress: address }, orderBy: { createdAt: 'desc' } });
    expect(message.status).toBe(MessageStatus.SENT);
    return tokenIn(message.body);
  };

  /** An owner who has set up the whole event over HTTP: venue, invitation, a guest who answered, a table, a vendor, a ticket sold. */
  const ownedEvent = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const owner = as(authorization);
    await owner.post('/organizations', { name: 'Hakobyan Weddings' }).expect(201);
    const { body: event } = await owner.post('/events', {
      type: EventType.WEDDING, title: 'Ani & Narek', templateKey: 'journey-11', startsAt: '2027-06-12T15:00:00.000Z',
      timezone: 'Asia/Yerevan', locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const eventId = event.id as string;
    const slug = event.invitation.slug as string;
    const base = `/events/${eventId}`;
    const { body: venue } = await owner.post(`${base}/venues`, { role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 120 }).expect(201);
    await owner.post(`/invitations/${slug}/publish`).expect(201);

    const { body: guest } = await owner.post(`${base}/guests`, {
      firstName: 'Lusine', lastName: 'Sargsyan', email: 'lusine@journey11.test', phone: '+37491000111', seatsAllotted: 1,
    }).expect(201);
    await http().post(api(`/invitations/${slug}/g/${guest.token as string}/rsvp`)).send({ status: 'ATTENDING' }).expect(201);

    const { body: table } = await owner.post(`${base}/tables`, { name: 'Table 1', capacity: 8, venueId: venue.id }).expect(201);
    await owner.post(`${base}/seats`, { guestId: guest.id, tableId: table.id }).expect(201);

    const { body: vendor } = await owner.post('/vendors', { name: 'Tashir Catering', category: 'CATERING' }).expect(201);
    await owner.post(`${base}/vendors`, { vendorId: vendor.id, feeMinor: '150000' }).expect(201);

    await owner.patch(`${base}/settings`, { visibility: 'PUBLIC' }).expect(200);
    const { body: type } = await owner.post(`${base}/ticket-types`, { name: { en: 'Guest pass' }, priceMinor: '0', quantityTotal: 20 }).expect(201);
    const { body: listing } = await owner.put(`${base}/listing`, { headline: { en: 'Ani & Narek' } }).expect(200);
    await owner.post(`${base}/listing/publish`).expect(201);
    const { body: order } = await http().post(api(`/public/events/${listing.slug as string}/orders`)).send({
      items: [{ ticketTypeId: type.id, quantity: 1 }], attendees: attendeeRoster(type.id as string, 1),
      buyerName: 'Karen', buyerEmail: 'karen@journey11.test', idempotencyKey: randomUUID(),
    }).expect(201);
    expect(order.status).toBe('PAID');

    return { owner, eventId, slug, base, guestId: guest.id as string, tableId: table.id as string, orderId: order.orderId as string };
  };
  type Owned = Awaited<ReturnType<typeof ownedEvent>>;

  /** Step 1-2: the owner invites by email with a role; the invitee accepts from the emailed link and signs in. */
  const joinsEvent = async (owned: Owned, email: string, role: 'DESIGNER' | 'VIEWER', password: string) => {
    const { body: sent } = await owned.owner.post(`${owned.base}/team/invites`, { email, role }).expect(201);
    expect(sent).toMatchObject({ sent: true, email, role });
    const token = await emailedToken('event.invite', email);
    const { body: accepted } = await http().post(api('/event-invites/accept')).send({ token, name: role.toLowerCase(), password }).expect(201);
    return { accepted, member: await signIn(email, password) };
  };

  const guestsSeenBy = async (caller: Caller, base: string) => {
    const { body } = await caller.get(`${base}/guests`).expect(200);
    return (body as { guests: ListedGuest[] }[]).flatMap((household) => household.guests);
  };
  /** The guest the owner added; the ticket buyer's attendee is on the list too. */
  const lusineSeenBy = async (caller: Caller, base: string) =>
    (await guestsSeenBy(caller, base)).find((guest) => guest.firstName === 'Lusine')!;
  const csvOf = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  const guestListCsv = async (caller: Caller, base: string) => {
    const { body: exported } = await caller.post(`${base}/exports`, { kind: 'GUEST_LIST' }).expect(201);
    const { text } = await caller.get(`${base}/exports/${exported.id as string}/download`).expect(200);
    return csvOf(text);
  };

  /** Step 3, designer: the invitation and nothing else. */
  const designerWalks = async (owned: Owned, designer: Caller) => {
    const { base, slug, eventId } = owned;
    expect(((await designer.get('/events').expect(200)).body as { id: string }[]).map((event) => event.id)).toEqual([eventId]);
    const { body: editor } = await designer.get(`/invitations/${slug}/design`).expect(200);
    expect(editor.template.key).toBe('journey-11');
    await designer.patch(`/invitations/${slug}/theme`, { palette: 'sage' }).expect(200);
    await designer.patch(`/invitations/${slug}/blocks/HERO`, { content: { en: { title: 'Ani & Narek are getting married' } } }).expect(200);
    // The owner sees the designer's work.
    const { body: ownerEditor } = await owned.owner.get(`/invitations/${slug}/design`).expect(200);
    expect(ownerEditor.theme).toMatchObject({ palette: 'sage' });
    expect((ownerEditor.blocks as { type: string; content: { en?: { title?: string } } }[]).find((block) => block.type === 'HERO')?.content.en?.title)
      .toBe('Ani & Narek are getting married');

    // No guest list, contacts, operations, seating, vendors, fees, exports, signatures, ticket orders, team or publishing.
    const refused = {
      [`${base}/guests`]: 'guest:read', [`${base}/guests/${owned.guestId}`]: 'guest:read', [`${base}/dashboard`]: 'operations:read',
      [`${base}/tables`]: 'seating:read', [`${base}/vendors`]: 'vendor:read', [`${base}/exports`]: 'operations:read',
      [`${base}/acknowledgements`]: 'guest:contact:read', [`${base}/gallery`]: 'guest:write', [`${base}/ticket-orders`]: 'operations:read',
      [`${base}/ticket-orders/${owned.orderId}`]: 'guest:read', [`${base}/team`]: 'member:manage', [`/invitations/${slug}/delivery`]: 'guest:read',
    };
    const seen: Record<string, { status: number; message: string }> = {};
    for (const path of Object.keys(refused)) seen[path] = await refusal(designer.get(path));
    expect(seen).toEqual(Object.fromEntries(Object.entries(refused).map(([path, permission]) => [path, mayNot(permission)])));
    expect(await refusal(designer.post(`${base}/exports`, { kind: 'GUEST_LIST' }))).toEqual(mayNot('operations:read'));
    expect(await refusal(designer.post(`${base}/guests`, { firstName: 'Intruder' }))).toEqual(mayNot('guest:write'));
    expect(await refusal(designer.post(`/invitations/${slug}/close`))).toEqual(mayNot('invitation:publish'));
  };

  /** Step 3, viewer: read-only, without contacts, door codes or fees. */
  const viewerWalks = async (owned: Owned, viewer: Caller) => {
    const { base, slug } = owned;
    const lusine = await lusineSeenBy(viewer, base);
    expect(lusine).toMatchObject({ firstName: 'Lusine', rsvpStatus: 'ATTENDING' });
    expect(lusine).not.toHaveProperty('email');
    expect(lusine).not.toHaveProperty('phone');
    expect(lusine).not.toHaveProperty('token');
    // The owner, by contrast, sees the contacts.
    expect(await lusineSeenBy(owned.owner, base)).toMatchObject({ email: 'lusine@journey11.test', phone: expect.any(String) });

    const { body: tables } = await viewer.get(`${base}/tables`).expect(200);
    expect(tables).toEqual([expect.objectContaining({ name: 'Table 1', seated: 1, guests: [expect.objectContaining({ name: 'Lusine Sargsyan' })] })]);
    expect(await refusal(viewer.post(`${base}/tables`, { name: 'Table 2', capacity: 8 }))).toEqual(mayNot('seating:write'));

    const [booking] = (await viewer.get(`${base}/vendors`).expect(200)).body as Booking[];
    expect(booking.vendor.name).toBe('Tashir Catering');
    expect(booking).not.toHaveProperty('feeMinor');
    expect(booking).not.toHaveProperty('briefToken');
    expect(await refusal(viewer.patch(`${base}/vendors/${booking.id}`, { feeMinor: '1' }))).toEqual(mayNot('vendor:write'));
    // The owner, by contrast, sees the fee, and it is untouched.
    expect(((await owned.owner.get(`${base}/vendors`).expect(200)).body as Booking[])[0]).toMatchObject({ feeMinor: '150000', briefToken: expect.any(String) });

    const [orderRow] = (await viewer.get(`${base}/ticket-orders`).expect(200)).body as Record<string, unknown>[];
    expect(orderRow).toMatchObject({ buyerName: 'Karen' });
    expect(orderRow).not.toHaveProperty('buyerEmail');
    const { body: order } = await viewer.get(`${base}/ticket-orders/${owned.orderId}`).expect(200);
    expect((order.tickets as object[])[0]).not.toHaveProperty('code');
    expect((order.tickets as object[])[0]).toMatchObject({ holderName: expect.any(String) });
    const { body: ownersOrder } = await owned.owner.get(`${base}/ticket-orders/${owned.orderId}`).expect(200);
    expect((ownersOrder.tickets as object[])[0]).toMatchObject({ code: expect.any(String) });
    expect(await refusal(viewer.post(`${base}/exports`, { kind: 'TICKET_MANIFEST' }))).toEqual(manifestRefused);

    const viewerCsv = await guestListCsv(viewer, base);
    expect(viewerCsv[0]).not.toMatch(/"Email"|"Phone"/);
    expect(viewerCsv.join('\n')).toContain('"Lusine"');
    expect(viewerCsv.join('\n')).not.toContain('lusine@journey11.test');
    const ownerCsv = await guestListCsv(owned.owner, base);
    expect(ownerCsv[0]).toContain('"Email"');
    expect(ownerCsv.join('\n')).toContain('lusine@journey11.test');

    const { body: dashboard } = await viewer.get(`${base}/dashboard`).expect(200);
    expect(dashboard.headcount).toMatchObject({ attending: 2 });
    const { body: editor } = await viewer.get(`/invitations/${slug}/design`).expect(200);
    expect(editor.theme).toMatchObject({ palette: 'sage' });
    expect(await refusal(viewer.get(`${base}/acknowledgements`))).toEqual(mayNot('guest:contact:read'));
    expect(await refusal(viewer.get(`${base}/team`))).toEqual(mayNot('member:manage'));
    expect(await refusal(viewer.patch(`/invitations/${slug}/theme`, { palette: 'ivory' }))).toEqual(mayNot('invitation:design'));
    expect(await refusal(viewer.post(`${base}/guests`, { firstName: 'Intruder' }))).toEqual(mayNot('guest:write'));
  };

  it('gives an invited designer only the invitation and an invited viewer a read-only event without contacts, door codes or fees', async () => {
    const owned = await ownedEvent();
    // The viewer already has an account; the designer is new to Aveline.
    await http().post(api('/auth/register')).send({ email: 'viewer@journey11.test', password: 'the-viewers-own-password', name: 'Viewer' }).expect(202);

    const designer = await joinsEvent(owned, 'designer@journey11.test', 'DESIGNER', 'the-designers-password');
    const viewer = await joinsEvent(owned, 'viewer@journey11.test', 'VIEWER', 'the-viewers-own-password');
    expect(designer.accepted).toMatchObject({ accountCreated: true });
    expect(viewer.accepted).toMatchObject({ accountCreated: false });
    const { body: team } = await owned.owner.get(`${owned.base}/team`).expect(200);
    expect(team.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ email: 'designer@journey11.test', role: 'DESIGNER' }),
      expect.objectContaining({ email: 'viewer@journey11.test', role: 'VIEWER' }),
    ]));
    expect(team.invites).toEqual([]);

    await designerWalks(owned, designer.member);
    await viewerWalks(owned, viewer.member);
    // Neither refused write landed.
    expect((await guestsSeenBy(owned.owner, owned.base)).map((guest) => guest.firstName)).not.toContain('Intruder');
    expect((await owned.owner.get(`/invitations/${owned.slug}/design`).expect(200)).body.theme).toMatchObject({ palette: 'sage' });
    // Accepting an event role grants nothing in the organization.
    expect(await prisma.organizationMembership.count({ where: { user: { email: { in: ['designer@journey11.test', 'viewer@journey11.test'] } } } })).toBe(0);
  });

  it('applies a role change on the invitee’s next request and cuts access on removal', async () => {
    const owned = await ownedEvent();
    const { member: viewer } = await joinsEvent(owned, 'viewer@journey11.test', 'VIEWER', 'the-viewers-own-password');
    const { member: designer } = await joinsEvent(owned, 'designer@journey11.test', 'DESIGNER', 'the-designers-password');
    const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
    expect(await lusineSeenBy(viewer, owned.base)).not.toHaveProperty('email');

    // The viewer becomes the coordinator: contacts, fees and writes arrive with the same session.
    await owned.owner.patch(`${owned.base}/team/${await userId('viewer@journey11.test')}`, { role: 'COORDINATOR' }).expect(200);
    expect(await lusineSeenBy(viewer, owned.base)).toMatchObject({ email: 'lusine@journey11.test' });
    expect(((await viewer.get(`${owned.base}/vendors`).expect(200)).body as Booking[])[0]).toMatchObject({ feeMinor: '150000' });
    const { body: added } = await viewer.post(`${owned.base}/guests`, { firstName: 'Armen' }).expect(201);
    expect((await guestsSeenBy(owned.owner, owned.base)).map((guest) => guest.id)).toContain(added.id);
    // Still not allowed to decide who else works on the event.
    expect(await refusal(viewer.post(`${owned.base}/team/invites`, { email: 'friend@journey11.test', role: 'VIEWER' }))).toEqual(mayNot('member:manage'));

    // The designer is taken off: the same session is locked out of everything at once.
    await designer.get(`/invitations/${owned.slug}/design`).expect(200);
    await owned.owner.delete(`${owned.base}/team/${await userId('designer@journey11.test')}`).expect(200);
    expect(await refusal(designer.get(`/invitations/${owned.slug}/design`))).toEqual(mayNot('invitation:read'));
    expect(await refusal(designer.patch(`/invitations/${owned.slug}/theme`, { palette: 'ivory' }))).toEqual(mayNot('invitation:design'));
    expect(await refusal(designer.get(`/events/${owned.eventId}`))).toEqual(mayNot('event:read'));
    expect((await designer.get('/events').expect(200)).body).toEqual([]);
  });

  it('gives an organization MANAGER every event to run and a MEMBER or VIEWER every event to read, through accepted invites', async () => {
    const owned = await ownedEvent();
    const { body: second } = await owned.owner.post('/events', {
      type: EventType.OTHER, title: 'Engagement dinner', templateKey: 'journey-11', startsAt: '2027-03-01T17:00:00.000Z', locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const join = async (email: string, role: 'MANAGER' | 'MEMBER' | 'VIEWER') => {
      await owned.owner.post('/organization/invites', { email, role }).expect(201);
      const token = await emailedToken('organization.invite', email);
      const { body: accepted } = await http().post(api('/invites/accept')).send({ token, name: role.toLowerCase(), password: `${role}-own-password` }).expect(201);
      expect(accepted).toMatchObject({ accountCreated: true });
      return signIn(email, `${role}-own-password`);
    };
    const manager = await join('manager@journey11.test', 'MANAGER');
    const member = await join('member@journey11.test', 'MEMBER');
    const viewer = await join('viewer@journey11.test', 'VIEWER');
    const eventIds = async (caller: Caller) => ((await caller.get('/events').expect(200)).body as { id: string }[]).map((event) => event.id).sort();
    const everyEvent = [owned.eventId, second.id as string].sort();

    // The manager runs both events, contacts and fees included, but cannot manage members or billing.
    expect(await eventIds(manager)).toEqual(everyEvent);
    expect(await lusineSeenBy(manager, owned.base)).toMatchObject({ email: 'lusine@journey11.test' });
    expect(((await manager.get(`${owned.base}/vendors`).expect(200)).body as Booking[])[0]).toMatchObject({ feeMinor: '150000' });
    await manager.post(`/events/${second.id as string}/guests`, { firstName: 'Davit', email: 'davit@journey11.test' }).expect(201);
    expect(await refusal(manager.post('/organization/invites', { email: 'other@journey11.test', role: 'MEMBER' }))).toEqual(mayNot('member:manage'));
    expect(await refusal(manager.get('/subscription'))).toEqual(mayNot('billing:read'));
    await owned.owner.get('/subscription').expect(200);
    expect(await refusal(manager.post(`${owned.base}/ticket-orders/${owned.orderId}/cancel`))).toEqual(mayNot('billing:write'));

    // The member and the viewer each read both events, without contacts or fees, and change nothing.
    for (const reader of [member, viewer]) {
      expect(await eventIds(reader)).toEqual(everyEvent);
      const seen = await guestsSeenBy(reader, `/events/${second.id as string}`);
      expect(seen).toEqual([expect.objectContaining({ firstName: 'Davit' })]);
      expect(seen[0]).not.toHaveProperty('email');
      expect(((await reader.get(`${owned.base}/vendors`).expect(200)).body as Booking[])[0]).not.toHaveProperty('feeMinor');
      expect(await refusal(reader.post(`${owned.base}/guests`, { firstName: 'Intruder' }))).toEqual(mayNot('guest:write'));
      expect(await refusal(reader.patch(`/invitations/${owned.slug}/theme`, { palette: 'ivory' }))).toEqual(mayNot('invitation:design'));
      expect(await refusal(reader.post(`${owned.base}/exports`, { kind: 'TICKET_MANIFEST' }))).toEqual(manifestRefused);
    }
    const invited = ['manager@journey11.test', 'member@journey11.test', 'viewer@journey11.test'];
    expect(await prisma.organizationMembership.findMany({ where: { user: { email: { in: invited } } }, select: { role: true }, orderBy: { role: 'asc' } }))
      .toEqual([{ role: 'MANAGER' }, { role: 'MEMBER' }, { role: 'VIEWER' }]);
  });
});
