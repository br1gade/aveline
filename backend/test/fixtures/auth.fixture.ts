import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { EventRole, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

/**
 * Registers an account, gives it a role on an event, and returns the header
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

  const { body } = await request(app.getHttpServer() as Server)
    .post('/api/auth/register')
    .send({ email, password: 'a-long-enough-test-password', name: 'Test User' })
    .expect(201);

  const user = await prisma.user.findUniqueOrThrow({ where: { email } });

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
