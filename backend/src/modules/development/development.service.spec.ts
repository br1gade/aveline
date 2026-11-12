import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsService } from '../../infra/jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DevelopmentService } from './development.service';

/**
 * These shortcuts send mail on demand and put a plan on sale at any price,
 * so they must not exist in production: root CLAUDE.md asks for development
 * affordances to be impossible to reach there, not merely discouraged.
 */
describe('DevelopmentService', () => {
  const serviceIn = (nodeEnv: string) => {
    const dispatchMessages = jest.fn().mockResolvedValue(undefined);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new DevelopmentService(
      { get: () => nodeEnv } as unknown as ConfigService,
      { dispatchMessages } as unknown as JobsService,
      { plan: { updateMany } } as unknown as PrismaService,
    );
    return { service, dispatchMessages, updateMany };
  };

  it.each([
    ['sending the outbox', (service: DevelopmentService) => service.sendOutbox()],
    ['offering a plan', (service: DevelopmentService) => service.offerPlan('planner-monthly', 25_000n)],
  ])('404s %s in production without touching anything', async (_shortcut, call) => {
    const { service, dispatchMessages, updateMany } = serviceIn('production');

    await expect(call(service)).rejects.toThrow(NotFoundException);
    expect(dispatchMessages).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('sends the outbox through the same locked job the schedule runs, so a send cannot overlap it', async () => {
    const { service, dispatchMessages } = serviceIn('development');

    await service.sendOutbox();

    expect(dispatchMessages).toHaveBeenCalledTimes(1);
  });
});
