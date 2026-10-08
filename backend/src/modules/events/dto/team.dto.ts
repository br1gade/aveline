import { ApiProperty } from '@nestjs/swagger';
import { EventRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class ChangeRoleDto {
  @ApiProperty({ enum: EventRole })
  @IsEnum(EventRole)
  role!: EventRole;
}
