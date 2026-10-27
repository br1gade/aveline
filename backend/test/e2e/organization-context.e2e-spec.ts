import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
describe('organization context HTTP', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(resetTestDatabase);
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  it('returns bounded minimal own memberships and validates selector headers only for scoped calls', async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    const organization = await prisma.organization.create({ data: { name: 'Family' } });
    await prisma.organizationMembership.create({ data: { userId, organizationId: organization.id, role: 'VIEWER' } });
    const response = await http().get('/api/v1/me/organizations?limit=1').set('Authorization', authorization).set('X-Aveline-Organization-Id', 'invalid,header').expect(200);
    expect(response.body.items[0]).toEqual({ organizationId: organization.id, name: 'Family', kind: 'HOST', role: 'VIEWER', joinedAt: expect.any(String) });
    expect(response.body.nextCursor).toBeNull();
    await http().get('/api/v1/events').set('Authorization', authorization).set('X-Aveline-Organization-Id', 'invalid,header').expect(400);
    await http().get('/api/v1/me/organizations?limit=101').set('Authorization', authorization).expect(400);
    await http().get('/api/v1/organizations/current').set('Authorization', authorization).set('X-Aveline-Organization-Id', 'foreign').expect(403);
  });
  it('allows a read-only member to leave but refuses removing another member', async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    const organization = await prisma.organization.create({ data: { name: 'Family' } });
    const owner = await prisma.user.create({ data: { email: 'owner@test.local', name: 'Owner' } });
    await prisma.organizationMembership.createMany({ data: [{ userId, organizationId: organization.id, role: 'MEMBER' }, { userId: owner.id, organizationId: organization.id, role: 'OWNER' }] });
    await http().delete(`/api/v1/organizations/current/members/${owner.id}?expectedRevision=0`).set('Authorization', authorization).expect(403);
    const response = await http().post('/api/v1/organizations/current/leave').set('Authorization', authorization).send({ expectedRevision: 0 }).expect(201);
    expect(response.body.removedUserId).toBe(userId);
    await http().get('/api/v1/organizations/current').set('Authorization', authorization).expect(403);
  });
});
