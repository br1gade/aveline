import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { EventRole, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { hashSync } from 'bcryptjs';

const TEST_PASSWORD = 'a-long-enough-test-password';
/** Hashed once per test file: registering hashed it on every call, which is most of a test's time. */
const TEST_PASSWORD_HASH = hashSync(TEST_PASSWORD, 12);

/**
 * Creates an account, signs it in, gives it a role on an event, and returns the header
 * an organizer request needs. Tests that exercise organizer surfaces say what
 * role they are acting as, which keeps the permission being relied on visible
 * in the test rather than implied.
 */
export async function authenticateAs(
  app: INestApplication,
  prisma: PrismaClient,
  options: { eventId?: string; role?: EventRole } = {},
): Promise<{ authorization: string; userId: string }> {
  const email = `test-${randomUUID().slice(0, 8)}@aveline.test`;

  const user = await prisma.user.create({
    data: { email, name: 'Test User', passwordHash: TEST_PASSWORD_HASH },
  });
  const { body } = await request(app.getHttpServer() as Server)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD })
    .expect(201);

  if (options.eventId) {
    await prisma.eventMembership.create({
      data: {
        userId: user.id,
        eventId: options.eventId,
        role: options.role ?? EventRole.OWNER,
      },
    });
  }

  return { authorization: `Bearer ${body.accessToken as string}`, userId: user.id };
}
