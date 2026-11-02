import { OwnerInviteDeliveryService } from './owner-invite-delivery.service';
import { EnquiryPrivacyController } from './enquiry-privacy.controller';
import { Module } from '@nestjs/common';
import { EnquiryPrivacyService } from './enquiry-privacy.service';
import { EnquiryRetentionService } from './enquiry-retention.service';

@Module({ controllers: [EnquiryPrivacyController], providers: [OwnerInviteDeliveryService, EnquiryPrivacyService, EnquiryRetentionService], exports: [OwnerInviteDeliveryService, EnquiryPrivacyService, EnquiryRetentionService] })
export class SalesPrivacyModule {}
