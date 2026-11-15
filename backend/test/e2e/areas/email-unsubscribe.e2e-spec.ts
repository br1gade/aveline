import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageChannel, PrismaClient, SuppressionReason } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { unsubscribeSecret, unsubscribeUrlFor } from '../../../src/modules/communications/email-unsubscribe';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * One-click unsubscribe (RFC 8058) from a host's guest mail (audit F-10). A
 * mail client POSTs the link from the List-Unsubscribe header; the guest stops
 * getting that host's mail, and nobody else's mail to them changes.
 */
describe('Unsubscribing from a host’s guest mail', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const sentMail = async (templateKey = 'invitation.send', hasOrganization = true) => {
    const organization = hasOrganization ? await prisma.organization.create({ data: { name: 'Petrosyan Wedding', kind: 'HOST' } }) : null;
    return prisma.message.create({
      data: { organizationId: organization?.id ?? null, channel: MessageChannel.EMAIL, templateKey, toAddress: 'Ani@Example.am', body: 'Dear Ani', status: 'SENT' },
    });
  };
  const oneClick = (path: string) => http().post(path).type('form').send('List-Unsubscribe=One-Click');
  const pathOf = (message: Awaited<ReturnType<typeof sentMail>>) =>
    new URL(unsubscribeUrlFor(message, 'https://aveline.test', unsubscribeSecret()) ?? 'https://aveline.test/none').pathname;
  const suppressions = () => prisma.suppression.findMany({ select: { organizationId: true, channel: true, address: true, reason: true } });

  it('stops that host’s mail to the address, and only that host’s', async () => {
    const message = await sentMail();

    await oneClick(pathOf(message)).expect(204);

    expect(await suppressions()).toEqual([
      { organizationId: message.organizationId, channel: MessageChannel.EMAIL, address: 'ani@example.am', reason: SuppressionReason.UNSUBSCRIBED },
    ]);
  });

  it('answers the same when pressed twice', async () => {
    const path = pathOf(await sentMail());
    await oneClick(path).expect(204);
    await oneClick(path).expect(204);
    expect(await suppressions()).toHaveLength(1);
  });

  it('refuses a link whose signature was altered, changing nothing', async () => {
    const path = pathOf(await sentMail());
    await oneClick(`${path.slice(0, -1)}${path.endsWith('A') ? 'B' : 'A'}`).expect(404);
    expect(await suppressions()).toEqual([]);
  });

  it('refuses mail nobody may opt out of, even with a valid signature', async () => {
    const reset = await sentMail('account.password-reset', false);
    const forged = pathOf({ ...reset, templateKey: 'invitation.send', organizationId: 'org' });

    await oneClick(forged).expect(404);
    expect(await suppressions()).toEqual([]);
  });
});
