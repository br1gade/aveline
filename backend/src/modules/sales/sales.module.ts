import { EventsModule } from '../events/events.module';
import { EnquiryConversionService } from './enquiry-conversion.service';
import { EnquiryConversionController } from './enquiry-conversion.controller';
import { Module } from '@nestjs/common';
import { EnquiriesController } from './enquiries.controller';
import { EnquiriesService } from './enquiries.service';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { SalesIntakeGuard } from './sales-intake.guard';
import { SalesPrivacyModule } from './sales-privacy.module';

@Module({ imports: [SalesPrivacyModule, EventsModule], controllers: [EnquiryConversionController, EnquiriesController, ConsultationsController], providers: [EnquiryConversionService, EnquiriesService, ConsultationsService, SalesIntakeGuard], exports: [EnquiriesService] })
export class SalesModule {}
