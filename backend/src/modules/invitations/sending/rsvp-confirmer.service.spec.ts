import { ConfigService } from '@nestjs/config';
import { RsvpConfirmerService } from './rsvp-confirmer.service';
import * as audience from './audience';

it('skips audience and template reads when the same response was already confirmed', async () => {
  const households = jest.spyOn(audience, 'loadSendableHouseholds').mockResolvedValue([]);
  const templates = jest.spyOn(audience, 'channelsWithCopy').mockResolvedValue([]);
  const prisma = { guest: { findUniqueOrThrow: jest.fn().mockResolvedValue({ householdId: 'household', event: {
    id: 'event', attendanceRevision: 1, organizationId: 'org', invitation: { slug: 'event' },
  } }) }, message: { findMany: jest.fn().mockResolvedValue([{ templateKey: 'rsvp.confirmation.attending', dedupeKey: 'prior:policy:1' }]) } };
  try {
    const service = new RsvpConfirmerService(prisma as never, {} as never, {} as never, new ConfigService({}));
    await service.confirm('guest', 'ATTENDING');
    expect(households).not.toHaveBeenCalled();
    expect(templates).not.toHaveBeenCalled();
  } finally { jest.restoreAllMocks(); }
});
