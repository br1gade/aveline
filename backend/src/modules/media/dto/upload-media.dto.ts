import { ApiPropertyOptional } from '@nestjs/swagger';
import { MediaKind } from '@prisma/client';
import { IsIn, ValidateIf } from 'class-validator';

export const PUBLIC_UPLOAD_KINDS: MediaKind[] = [MediaKind.PHOTO, MediaKind.COVER, MediaKind.LOGO, MediaKind.AUDIO];

export class UploadMediaDto {
  @ApiPropertyOptional({ enum: PUBLIC_UPLOAD_KINDS })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(PUBLIC_UPLOAD_KINDS)
  kind?: MediaKind;
}
