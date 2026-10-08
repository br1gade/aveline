import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class NotifyChangesDto {
  @ApiPropertyOptional({
    description: 'A line from the host, added to the message, e.g. "We have moved to the garden."',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
