import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

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
}
