import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { InvitesController } from './invites.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { allowsDevelopmentShortcuts } from '../../common/environment';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret && !allowsDevelopmentShortcuts(config.get<string>('NODE_ENV'))) {
          // Refusing to boot is the only safe response: a default secret in
          // production means anyone can mint a staff token.
          throw new Error('JWT_SECRET must be set outside development and test');
        }
        return { secret: secret ?? 'development-only-secret-do-not-use-in-production' };
      },
    }),
  ],
  controllers: [AuthController, InvitesController],
  providers: [AuthService, AccountService, AuthGuard],
  exports: [AuthService, AccountService, AuthGuard, JwtModule],
})
export class AuthModule {}
