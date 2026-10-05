import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BlockType, QuestionType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Translated content arrives as { "<locale>": { ... } } and is bounded by
 *  the payload limit rather than field by field, because block content is
 *  template-shaped and varies. */
export class UpdateBlockDto {
  @ApiPropertyOptional({ description: 'Translated content keyed by locale' })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Block-specific, non-translated settings' })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Template layout variant, e.g. "split"' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  variant?: string;

  @ApiPropertyOptional({ isArray: true, type: String, description: 'MediaAsset ids, in order' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  assetIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateThemeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  headingFont?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bodyFont?: string;

  @ApiPropertyOptional({ description: "One of the template's palette names" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  palette?: string;

  @ApiPropertyOptional({ isArray: true, type: String, description: 'Hex colours, e.g. #1a2b3c' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  colors?: string[];
}

export class ChooseTemplateDto {
  @ApiProperty({ description: "A template's key, from GET /design-templates" })
  @IsString()
  @MaxLength(64)
  templateKey!: string;
}

export class UpsertQuestionDto {
  @ApiProperty({ enum: QuestionType })
  @IsEnum(QuestionType)
  type!: QuestionType;

  @ApiProperty({ description: 'Translated prompt keyed by locale' })
  @IsObject()
  prompt!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Translated choices, for the choice types' })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;
}

export class CreateVenueDto {
  @ApiProperty({ enum: ['CEREMONY', 'RECEPTION', 'AFTER_PARTY', 'PREPARATION', 'OTHER'] })
  @IsString()
  role!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  address!: string;

  @ApiPropertyOptional({ description: 'Reusable directory entry this came from' })
  @IsOptional()
  @IsString()
  profileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mapUrl?: string;

  @ApiPropertyOptional({ description: 'When guests should arrive, ISO 8601' })
  @IsOptional()
  @IsString()
  arriveAt?: string;
}


export class UpsertTimelineEntryDto {
  @ApiProperty({ description: 'Translated name keyed by locale', example: { hy: 'Պսակադրություն' } })
  @IsObject()
  label!: Record<string, unknown>;

  @ApiProperty({ description: 'When it happens, ISO 8601' })
  @IsISO8601()
  occursAt!: string;

  @ApiPropertyOptional({ description: 'Which of this event’s venues it happens at' })
  @IsOptional()
  @IsString()
  venueId?: string;

  @ApiPropertyOptional({
    description: 'Breaks ties between entries at the same minute',
    minimum: 0,
    maximum: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000)
  sortOrder?: number;
}

export { BlockType };
