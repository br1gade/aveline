import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { allowsDevelopmentShortcuts } from '../../common/environment';
import { JobsService } from '../../infra/jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Shortcuts that let the client's end-to-end suite run against a local stack
 * without waiting on a schedule or editing the database (FR-152, FR-154).
 *
 * Each is a 404 outside development and test, the same as the fake bank: the
 * routes stay in the schema so it does not differ by environment, but in
 * production they reach nothing.
 */
@Injectable()
export class DevelopmentService {
  private readonly isAvailable: boolean;

  constructor(
    config: ConfigService,
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
  ) {
    this.isAvailable = allowsDevelopmentShortcuts(config.get<string>('NODE_ENV'));
  }

  /** Runs the outbox job now rather than at the next minute; under its lock, so it never sends twice. */
  async sendOutbox(): Promise<void> {
    this.assertAvailable();
    await this.jobs.dispatchMessages();
  }

  /** Puts a plan on sale at this price; the production seed leaves every paid plan off at 0. */
  async offerPlan(planKey: string, priceMinor: bigint): Promise<void> {
    this.assertAvailable();
    const { count } = await this.prisma.plan.updateMany({ where: { key: planKey }, data: { isActive: true, priceMinor } });
    if (!count) throw new NotFoundException(`No plan ${planKey}`);
  }

  private assertAvailable(): void {
    if (!this.isAvailable) throw new NotFoundException();
  }
}
