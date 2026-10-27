import { Body, Controller, Get, Header, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { ConsultationsService } from './consultations.service';
import { SalesIntakeGuard } from './sales-intake.guard';
import { ConsultationAvailabilityDto, CreateConsultationDto, UpdateConsultationDto } from './dto/consultation.dto';

@ApiTags('sales')
@Controller('sales')
@UseGuards(SalesIntakeGuard)
@RequirePermission('enquiry:manage')
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 printable ASCII characters' })
@Post('enquiries/:enquiryId/consultations') @Header('Cache-Control', 'private, no-store')
  create(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Headers('idempotency-key') key: string, @Body() dto: CreateConsultationDto) {
    return this.consultations.create(actor.userId, enquiryId, { key, dto });
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 printable ASCII characters' })
@Patch('enquiries/:enquiryId/consultations/:consultationId') @Header('Cache-Control', 'private, no-store')
  update(@CurrentActor() actor: RequestActor, @Param() params: { enquiryId: string; consultationId: string }, @Headers('idempotency-key') key: string, @Body() dto: UpdateConsultationDto) {
    return this.consultations.update(actor.userId, params.enquiryId, { key, consultationId: params.consultationId, dto });
  }
  @Get('consultation-availability') @Header('Cache-Control', 'private, no-store')
  availability(@CurrentActor() actor: RequestActor, @Query() query: ConsultationAvailabilityDto) {
    return this.consultations.availability(actor.userId, query);
  }
}
