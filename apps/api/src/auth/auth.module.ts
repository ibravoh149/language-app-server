import { Module } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limiter.service';
import { EmailService } from '../email/email.service';
import { MeController } from '../users/me.controller';
import { UsersService } from '../users/users.service';
import { AccessGuard, VerifiedGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CodesService } from './codes.service';
import { TokensService } from './tokens.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, TokensService, CodesService, UsersService, EmailService, RateLimiter, AccessGuard, VerifiedGuard],
  exports: [AuthService, TokensService, UsersService, RateLimiter, AccessGuard, VerifiedGuard],
})
export class AuthModule {}
