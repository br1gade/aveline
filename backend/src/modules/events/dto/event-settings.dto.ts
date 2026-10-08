import { ApiPropertyOptional } from '@nestjs/swagger';
import { EventVisibility } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

/** Omitted means "leave as is". */
export class UpdateEventSettingsDto {
  @ApiPropertyOptional({
    description:
      'Whether the automatic RSVP reminders go out. On by default; some hosts ' +
      'chase by phone and would rather we did not write to their guests.',
  })
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @ApiPropertyOptional({
    enum: EventVisibility,
    description:
      'PRIVATE is reachable only by invitation link. PUBLIC and UNLISTED allow a ' +
      'public listing and ticket sales. Making an event PRIVATE takes its listing down.',
  })
  @IsOptional()
  @IsEnum(EventVisibility)
  visibility?: EventVisibility;
}
