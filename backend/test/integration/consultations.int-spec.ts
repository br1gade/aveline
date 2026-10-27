import { ConfigService } from '@nestjs/config';
import { EnquiriesService } from '../../src/modules/sales/enquiries.service';
import { ConsultationsService } from '../../src/modules/sales/consultations.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('atomic operator consultation exclusion', () => {
  const prisma = testPrisma();
  let enquiries: EnquiriesService;
  let consultations: ConsultationsService;
  beforeEach(async () => {
    await resetTestDatabase();
    const config = new ConfigService({ SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }) });
    enquiries = new EnquiriesService(prisma as PrismaService, config);
    consultations = new ConsultationsService(prisma as PrismaService, enquiries);
  });
  afterAll(disconnectTestDatabase);
  it('lets one opposing overlap commit, rolls back the loser, and permits adjacent slots', async () => {
    const staff = await prisma.user.create({ data: { email: 'support@example.am', name: 'Operator', platformRole: 'SUPPORT' } });
    const [first, second] = await Promise.all(['first-case-key', 'second-case-key'].map((key) => enquiries.create(staff.id, key, { contact: { name: 'Prospect', phone: '+37499123456' } })));
    const dto = { expectedRevision: 1, operatorUserId: staff.id, startsAt: '2026-10-26T10:00:00Z', endsAt: '2026-10-26T11:00:00Z', timezone: 'Asia/Yerevan' };
    const results = await Promise.allSettled([consultations.create(staff.id, first.enquiry.id, { key: 'first-slot-key', dto }), consultations.create(staff.id, second.enquiry.id, { key: 'second-slot-key', dto })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain('CONSULTATION_CONFLICT');
    expect(await prisma.consultation.count()).toBe(1);
    expect(await prisma.enquiryActivity.count()).toBe(3);
    expect(await prisma.enquiryCommand.count()).toBe(3);
    const losingCase = results[0].status === 'rejected' ? first : second;
    await consultations.create(staff.id, losingCase.enquiry.id, { key: 'adjacent-slot-key', dto: { ...dto, startsAt: '2026-10-26T11:00:00Z', endsAt: '2026-10-26T12:00:00Z' } });
    const availability = await consultations.availability(staff.id, { operatorUserId: staff.id, from: '2026-10-26T00:00:00Z', to: '2026-10-27T00:00:00Z' });
    expect(availability.busy).toHaveLength(2);
    expect(Object.keys(availability.busy[0])).toEqual(['startsAt', 'endsAt']);
  });
});
