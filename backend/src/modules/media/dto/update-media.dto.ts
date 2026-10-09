import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

export class UpdateMediaDto {
  @ApiProperty({
    description: 'Alt text keyed by locale, e.g. { "en": "Anna and Davit" }; null removes a language',
    example: { hy: 'Աննան և Դավիթը', en: 'Anna and Davit' },
  })
  @IsObject()
  altText!: Record<string, unknown>;
}
