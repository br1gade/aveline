import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

export class RegisterDto extends LoginDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  @MaxLength(200)
  refreshToken!: string;
}
