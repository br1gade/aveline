import { Response } from 'express';
import { Body, Controller, Get, Header, Headers, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { EnquiriesService } from './enquiries.service';
import { SalesIntakeGuard } from './sales-intake.guard';
import { AssignEnquiryDto, CreateEnquiryDto, EnquiryNoteDto, EnquiryPageDto, EnquiryQueueDto, StageEnquiryDto, UpdateEnquiryDto } from './dto/enquiry.dto';

@ApiTags('sales')
@Controller('sales/enquiries')
@UseGuards(SalesIntakeGuard)
@RequirePermission('enquiry:manage')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 printable ASCII characters' })
@Post() @Header('Cache-Control', 'private, no-store')
  async create(@CurrentActor() actor: RequestActor, @Headers('idempotency-key') key: string, @Body() dto: CreateEnquiryDto, @Res({ passthrough: true }) response: Response) {
    const { wasReplayed, ...result } = await this.enquiries.create(actor.userId, key, dto);
    response.status(wasReplayed ? 200 : 201);
    return result;
  }
  @Get() @Header('Cache-Control', 'private, no-store')
  list(@CurrentActor() actor: RequestActor, @Query() query: EnquiryQueueDto) {
    return this.enquiries.list(actor.userId, query);
  }
  @Get(':enquiryId') @Header('Cache-Control', 'private, no-store')
  detail(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string) {
    return this.enquiries.detail(actor.userId, enquiryId);
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 printable ASCII characters' })
@Patch(':enquiryId') @Header('Cache-Control', 'private, no-store')
  update(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Headers('idempotency-key') key: string, @Body() dto: UpdateEnquiryDto) {
    return this.enquiries.update(actor.userId, enquiryId, { key, dto });
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 printable ASCII characters' })
@Post(':enquiryId/assignment') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  @RequirePermission('enquiry:assign')
  assign(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Headers('idempotency-key') key: string, @Body() dto: AssignEnquiryDto) {
    return this.enquiries.assign(actor.userId, enquiryId, { key, dto });
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 printable ASCII characters' })
@Post(':enquiryId/stage') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  stage(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Headers('idempotency-key') key: string, @Body() dto: StageEnquiryDto) {
    return this.enquiries.stage(actor.userId, enquiryId, { key, dto });
  }
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: '8–128 printable ASCII characters' })
@Post(':enquiryId/notes') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  note(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Headers('idempotency-key') key: string, @Body() dto: EnquiryNoteDto) {
    return this.enquiries.addNote(actor.userId, enquiryId, { key, dto });
  }
  @Get(':enquiryId/notes') @Header('Cache-Control', 'private, no-store')
  notes(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Query() query: EnquiryPageDto) {
    return this.enquiries.section(actor.userId, enquiryId, { section: 'notes', query });
  }
  @Get(':enquiryId/activities') @Header('Cache-Control', 'private, no-store')
  activities(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Query() query: EnquiryPageDto) {
    return this.enquiries.section(actor.userId, enquiryId, { section: 'activities', query });
  }
  @Get(':enquiryId/consultations') @Header('Cache-Control', 'private, no-store')
  consultations(@CurrentActor() actor: RequestActor, @Param('enquiryId') enquiryId: string, @Query() query: EnquiryPageDto) {
    return this.enquiries.section(actor.userId, enquiryId, { section: 'consultations', query });
  }
}
