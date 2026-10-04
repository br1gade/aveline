import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Public, RequestActor } from './actor';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create an account and start a session' })
  register(
    @Body() dto: RegisterDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.auth.register(dto, { userAgent, ipAddress });
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Exchange credentials for a token pair' })
  login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.auth.login(dto, { userAgent, ipAddress });
  }

  @Public()
  @Post('refresh')
  @ApiOperation({
    summary: 'Rotate a refresh token for a new pair',
    description: 'The presented token is revoked, so a stolen one works at most once.',
  })
  refresh(
    @Body() dto: RefreshDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.auth.refresh(dto.refreshToken, { userAgent, ipAddress });
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke one session' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  @Post('logout-everywhere')
  @ApiOperation({ summary: 'Revoke every session for the signed-in account' })
  logoutEverywhere(@CurrentActor() actor: RequestActor) {
    return this.auth.revokeAllSessions(actor.userId);
  }
}
