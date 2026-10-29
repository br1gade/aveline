import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateInvitationDto {
  @ApiPropertyOptional({ description: 'Omitted picks the first active template' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  templateKey?: string;
  @ApiPropertyOptional({ description: 'Exact active version from the selected organization catalogue; a stale or unavailable version is 404.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  templateVersionId?: string;
}
