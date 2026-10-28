import { Body, Controller, HttpCode, Post, RawBodyRequest, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../infra/auth/actor';
import { EmailFeedbackDto } from './dto/email-feedback.dto';
import { verifyEmailFeedback } from './email-feedback-auth';
import { EmailFeedbackService } from './email-feedback.service';

@ApiTags('communications')
@Controller('communications/email-feedback')
export class EmailFeedbackController {
  constructor(private readonly feedback: EmailFeedbackService) {}

  @Public()
  @Post()
  @HttpCode(202)
  @ApiHeader({ name: 'x-aveline-feedback-timestamp', required: true, description: 'Unix timestamp in seconds, within five minutes of server time' })
  @ApiHeader({ name: 'x-aveline-feedback-signature', required: true, description: 'Hex HMAC-SHA256 over timestamp + dot + exact raw request bytes' })
  @ApiOperation({ summary: 'Accept normalized email delivery feedback from a trusted signed adapter', description: 'Requires an HMAC signature of timestamp + dot + raw request bytes. Native provider payloads are not accepted.' })
  receive(@Req() request: RawBodyRequest<Request>, @Body() dto: EmailFeedbackDto) {
    verifyEmailFeedback(request.rawBody, { timestamp: request.get('x-aveline-feedback-timestamp'), signature: request.get('x-aveline-feedback-signature') }, process.env.EMAIL_FEEDBACK_SECRET);
    return this.feedback.receive(dto);
  }
}
