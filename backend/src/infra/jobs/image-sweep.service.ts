import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ImageVariantsService } from '../../modules/media/image-variants.service';
import { JobLockService, SCHEDULES } from './job-lock.service';

/**
 * Makes smaller copies of newly uploaded photos, a few at a time, every
 * minute. Out of the request because resizing is CPU work; under the lock so
 * two instances do not resize the same photo twice.
 */
@Injectable()
export class ImageSweepService {
  private readonly logger = new Logger(ImageSweepService.name);

  constructor(
    private readonly lock: JobLockService,
    private readonly images: ImageVariantsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async resizeNewPhotos(): Promise<void> {
    await this.lock.runExclusively(
      { name: 'media.resize', ttlSeconds: 55, crontab: SCHEDULES.everyMinute },
      async () => {
        const result = await this.images.processPending();
        if (result.processed + result.failed > 0) {
          this.logger.log(`photos: ${result.processed} resized, ${result.failed} could not be`);
        }
      },
    );
  }
}
