import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @ApiPropertyOptional({ description: 'Omitted picks the first active template' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  templateKey?: string;
}
