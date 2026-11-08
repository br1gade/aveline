import { TicketOrderStatus, TicketStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class TicketSelectionFeedbackDto {
  @ApiProperty()
  sectionKey!: string;

  @ApiProperty({ required: false })
  seatId?: string;
}

export class MissingAdmissionAcknowledgementDto {
  @ApiProperty()
  questionId!: string;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  labels!: Record<string, string>;
}

export class AdmissionFeedbackDto {
  @ApiPropertyOptional()
  guestId?: string;

  @ApiPropertyOptional()
  holderName?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  arrivedAt?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  usedAt?: string;

  @ApiPropertyOptional({ enum: TicketOrderStatus })
  orderStatus?: TicketOrderStatus;

  @ApiPropertyOptional()
  isCancellationPending?: boolean;

  @ApiPropertyOptional({ enum: TicketStatus })
  ticketStatus?: TicketStatus;

  @ApiPropertyOptional({ type: [MissingAdmissionAcknowledgementDto] })
  missingAcknowledgements?: MissingAdmissionAcknowledgementDto[];
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
  @ApiProperty({ required: false, type: TicketSelectionFeedbackDto })
  selection?: { sectionKey: string; seatId?: string };
  @ApiPropertyOptional({ type: AdmissionFeedbackDto })
  admission?: AdmissionFeedbackDto;
  @ApiProperty()
  path!: string;
  @ApiProperty({ format: 'date-time' })
  at!: string;
}

export const FEEDBACK_MODELS = [FieldFeedbackDto, JobRecoveryDto, HttpErrorDto];
