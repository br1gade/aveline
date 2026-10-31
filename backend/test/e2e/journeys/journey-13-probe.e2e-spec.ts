import { PrismaClient } from '@prisma/client';
import { InterruptibleLink } from '../../fixtures/coverage/journey-13.fixture';
it('probe', async () => {
  const link = new InterruptibleLink({ host: '127.0.0.1', port: 5433 });
  await link.start();
  const p = new PrismaClient({ datasources: { db: { url: `postgresql://aveline:aveline@127.0.0.1:${link.port}/aveline_test_journey13?schema=public&connection_limit=3&connect_timeout=2&pool_timeout=2` } } });
  const out: string[] = [];
  out.push(String(await p.$queryRaw`SELECT 1 as x`.then(() => 'ok')));
  await link.stop();
  for (let i = 0; i < 3; i++) out.push('down ' + await p.$queryRaw`SELECT 1`.then(() => 'ok', (e: Error) => e.message.split('\n').pop()));
  await link.start();
  for (let i = 0; i < 6; i++) out.push('up ' + await p.$queryRaw`SELECT 1`.then(() => 'ok', (e: Error) => e.message.split('\n').pop()));
  console.log(out.join('\n'));
  await p.$disconnect(); await link.stop();
  expect(1).toBe(1);
});
