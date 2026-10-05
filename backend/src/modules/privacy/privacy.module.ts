import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { SuppressionsController } from './suppressions.controller';

/**
 * Suppression lives in `communications` because the outbox is what consults
 * it; its organizer-facing routes live here because managing who may be
 * contacted is the same job as handling an erasure request.
 */
@Module({
  controllers: [PrivacyController, SuppressionsController],
  providers: [PrivacyService],
})
export class PrivacyModule {}
