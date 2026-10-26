import { ApiProperty } from '@nestjs/swagger';
import { FEEDBACK } from './feedback-copy';

export class FieldFeedbackDto {
  @ApiProperty({ type: String, nullable: true, description: 'DTO field path when identifiable; otherwise null.' })
  field!: string | null;
  @ApiProperty({ description: 'Stable validation classification, such as INVALID_EMAIL or REQUIRED_FIELD.' })
  code!: string;
  @ApiProperty()
  userMessage!: string;
}

export class JobRecoveryDto {
  @ApiProperty({ enum: Object.keys(FEEDBACK) })
  code!: string;
  @ApiProperty({ enum: ['en', 'ru', 'fr', 'hy'] })
  locale!: string;
  @ApiProperty()
  userMessage!: string;
  @ApiProperty({ enum: ['EDIT', 'SIGN_IN', 'REQUEST_ACCESS', 'CONTACT_HOST', 'RELOAD', 'REGENERATE', 'WAIT', 'REUPLOAD', 'CONTACT_SUPPORT', 'RETRY', 'SELECT_ORGANIZATION', 'HAND_OVER_OWNERSHIP'] })
  action!: string;
}

export class HttpErrorDto extends JobRecoveryDto {
  @ApiProperty()
  statusCode!: number;
  @ApiProperty({ oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }, { type: 'object', additionalProperties: true }] })
  message!: unknown;
  @ApiProperty({ type: [FieldFeedbackDto], maxItems: 100 })
  details!: FieldFeedbackDto[];
  @ApiProperty({ required: false })
  requestId?: string;
  @ApiProperty()
  path!: string;
  @ApiProperty({ format: 'date-time' })
  at!: string;
}

export const FEEDBACK_MODELS = [FieldFeedbackDto, JobRecoveryDto, HttpErrorDto];
