import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

export class SendInvitationDto {
  @ApiPropertyOptional({
    isArray: true,
    type: String,
    description:
      'Send only to these guests’ households. Omitted invites every household ' +
      'on the event that has not been invited yet.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1_000)
  @IsString({ each: true })
  guestIds?: string[];
}
