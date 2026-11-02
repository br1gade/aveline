import { Body, Controller, Header, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequestActor, RequirePermission } from '../../infra/auth/actor';
import { EnquiryPrivacyService } from './enquiry-privacy.service';
import { BindEnquirySubjectsDto, CreateEnquiryPrivacyRequestDto, EnquirySubjectCandidatesDto } from './dto/enquiry-privacy.dto';

@ApiTags('privacy')
@Controller('privacy')
@RequirePermission('privacy:manage')
export class EnquiryPrivacyController {
  constructor(private readonly privacy: EnquiryPrivacyService) {}
  @Post('enquiry-requests') @Header('Cache-Control', 'private, no-store')
  create(@CurrentActor() actor: RequestActor, @Body() dto: CreateEnquiryPrivacyRequestDto) {
    return this.privacy.createRequest(actor.userId, dto);
  }
  @Put('requests/:requestId/enquiry-subjects') @Header('Cache-Control', 'private, no-store')
  bind(@CurrentActor() actor: RequestActor, @Param('requestId') requestId: string, @Body() dto: BindEnquirySubjectsDto) {
    return this.privacy.bindSubjects(actor.userId, requestId, dto);
  }
  @Post('enquiry-subject-candidates') @HttpCode(200) @Header('Cache-Control', 'private, no-store')
  candidates(@Body() dto: EnquirySubjectCandidatesDto) {
    return this.privacy.candidates(dto);
  }
}
