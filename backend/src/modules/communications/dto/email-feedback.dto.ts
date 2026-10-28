import { ApiProperty } from '@nestjs/swagger';
import { EmailFeedbackOutcome } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsIsoTimestamp } from '../../../common/iso-timestamp';

export class EmailFeedbackDto {
  @ApiProperty({ description: 'Unique, opaque receipt key from the trusted adapter; not an address or token' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  @Matches(/^[a-zA-Z0-9._:-]+$/)
  receiptKey!: string;

  @ApiProperty({ description: 'Internal outbound Message id from X-Aveline-Message-Id' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  messageId!: string;

  @ApiProperty({ enum: EmailFeedbackOutcome })
  @IsEnum(EmailFeedbackOutcome)
  outcome!: EmailFeedbackOutcome;

  @ApiProperty({ description: 'When the delivery event occurred, in ISO 8601 UTC' })
  @IsIsoTimestamp()
  @Matches(/T.*Z$/)
  @MaxLength(40)
  occurredAt!: string;
}
