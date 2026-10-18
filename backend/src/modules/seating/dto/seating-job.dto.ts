import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateSeatingJobDto {
  @ApiProperty({ description: 'UUID v4; reuse only to retry this exact request' })
  @IsUUID('4')
  idempotencyKey!: string;
}
