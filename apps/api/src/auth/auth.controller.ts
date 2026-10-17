import { Body, Controller, Headers, HttpCode, Ip, Post, UseGuards } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limiter.service';
import { validate } from '../common/validate';
import { AccessGuard, UserId } from './auth.guard';
import {
  ForgotPasswordSchema,
  LoginSchema,
  RefreshSchema,
  ResetPasswordSchema,
  SignupSchema,
  VerifyEmailSchema,
} from './auth.schemas';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

/** Email + password auth. Contract: docs/api/auth-onboarding.md */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    private readonly limiter: RateLimiter,
  ) {}

  @Post('signup')
  @HttpCode(201)
  signup(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    this.limiter.hit(`signup:${ip}`, 10, 3600);
    return this.auth.signup(validate(SignupSchema, body), ua);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    const input = validate(LoginSchema, body);
    this.limiter.hit(`login:${ip}`, 20, 900);
    this.limiter.hit(`login:${input.email}`, 10, 900);
    return this.auth.login(input, ua);
  }

  @Post('email/verify')
  @HttpCode(200)
  @UseGuards(AccessGuard)
  async verify(@UserId() userId: string, @Body() body: unknown) {
    const { code } = validate(VerifyEmailSchema, body);
    return { user: await this.auth.verifyEmail(userId, code) };
  }

  @Post('email/resend')
  @HttpCode(202)
  @UseGuards(AccessGuard)
  resend(@UserId() userId: string) {
    return this.auth.resendVerification(userId);
  }

  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body() body: unknown, @Ip() ip: string) {
    this.limiter.hit(`forgot:${ip}`, 10, 900);
    await this.auth.forgotPassword(validate(ForgotPasswordSchema, body).email);
    return {};
  }

  @Post('password/reset')
  @HttpCode(200)
  reset(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    this.limiter.hit(`reset:${ip}`, 20, 900);
    return this.auth.resetPassword(validate(ResetPasswordSchema, body), ua);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    this.limiter.hit(`refresh:${ip}`, 60, 900);
    return { tokens: await this.tokens.refresh(validate(RefreshSchema, body).refreshToken, ua) };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AccessGuard)
  async logout(@UserId() userId: string, @Body() body: unknown) {
    await this.tokens.revoke(userId, validate(RefreshSchema, body).refreshToken);
  }
}
