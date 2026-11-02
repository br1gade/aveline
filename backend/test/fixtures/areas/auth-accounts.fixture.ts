import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageChannel, OrganizationRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../auth.fixture';

/** The real AppModule over the test database, configured as main.ts configures it. */
export async function accountsApp(prisma: PrismaClient): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  return app;
}

export const http = (app: INestApplication) => request(app.getHttpServer() as Server);

/** Outside production the API returns the link it would have emailed. */
export function tokenFrom(body: unknown): string {
  const { devLink } = body as { devLink?: string };
  if (!devLink) throw new Error('expected a devLink outside production');
  return new URL(devLink).searchParams.get('token') ?? '';
}

/** Platform copy the invite flows render; without it the outbox write fails the invite. */
export async function seedInviteTemplates(prisma: PrismaClient): Promise<void> {
  await prisma.messageTemplate.createMany({
    data: ['organization.invite', 'event.invite'].map((key) => ({
      organizationId: null, key, channel: MessageChannel.EMAIL, subject: { hy: 'Aveline' }, body: { hy: '{{link}}' },
    })),
  });
}

export interface SignedInMember {
  authorization: string;
  userId: string;
}

/** A signed-in account holding `role` in `organizationId`. */
export async function memberOf(
  app: INestApplication,
  prisma: PrismaClient,
  organizationId: string,
  role: OrganizationRole,
): Promise<SignedInMember> {
  const member = await authenticateAs(app, prisma);
  await prisma.organizationMembership.create({ data: { userId: member.userId, organizationId, role } });
  return member;
}
