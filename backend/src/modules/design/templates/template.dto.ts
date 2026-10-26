import { IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class CreateTemplateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) organizationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) key?: string;
  @ApiProperty() @IsObject() definition!: Record<string, unknown>;
}
export class PatchTemplateDraftDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
  @ApiProperty() @IsObject() definition!: Record<string, unknown>;
}
export class TemplateRevisionDto {
  @ApiProperty() @IsInt() @Min(1) @Max(2147483647) expectedRevision!: number;
}
export class TemplateAssignmentDto extends TemplateRevisionDto {
  @ApiProperty() @IsString() @MaxLength(128) userId!: string;
}
export class PublishTemplateDto extends TemplateRevisionDto {
  @ApiProperty() @IsUUID() idempotencyKey!: string;
  @ApiProperty() @IsString() @MaxLength(128) previewId!: string;
  @ApiProperty() @IsString() @MaxLength(64) contentHash!: string;
}
