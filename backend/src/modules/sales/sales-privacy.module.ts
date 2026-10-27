import { Module } from '@nestjs/common';
import { EnquiryPrivacyService } from './enquiry-privacy.service';
import { EnquiryRetentionService } from './enquiry-retention.service';

@Module({ providers: [EnquiryPrivacyService, EnquiryRetentionService], exports: [EnquiryPrivacyService, EnquiryRetentionService] })
export class SalesPrivacyModule {}
