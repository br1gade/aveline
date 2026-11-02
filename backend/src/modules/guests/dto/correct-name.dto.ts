import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, NotContains, ValidateIf } from 'class-validator';
import { Trimmed } from '../../../common/trimmed';

// Postgres text cannot store a null character; reject it before the write.
const NULL_CHARACTER = String.fromCharCode(0);

export class CorrectNameDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Trimmed()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @NotContains(NULL_CHARACTER, { message: 'firstName must not contain null characters' })
  firstName?: string;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @Trimmed()
  @IsString()
  @MaxLength(100)
  @NotContains(NULL_CHARACTER, { message: 'lastName must not contain null characters' })
  lastName?: string | null;
}
