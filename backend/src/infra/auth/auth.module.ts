import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { InvitesController } from './invites.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { jwtSecret } from './jwt-secret';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: jwtSecret(config.get<string>('JWT_SECRET'), config.get<string>('NODE_ENV')),
      }),
    }),
  ],
  controllers: [AuthController, InvitesController, MeController],
  providers: [AuthService, AccountService, AuthGuard],
  exports: [AuthService, AccountService, AuthGuard, JwtModule],
})
export class AuthModule {}
