import { Body, Controller, Delete, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { RateLimiter } from '../common/rate-limiter.service';
import { AccessGuard, UserId } from '../auth/auth.guard';
import { DeleteAccountSchema, ProfilePatchSchema } from '../auth/auth.schemas';
import { validate } from '../common/validate';
import { UsersService } from './users.service';

/** The signed-in user's account and onboarding profile. */
@Controller('me')
@UseGuards(AccessGuard)
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly limiter: RateLimiter,
  ) {}

  /** 🔒 Works for unverified users too, so the app can route them to the verify screen. */
  @Get()
  async me(@UserId() userId: string) {
    const user = await this.users.requireUser(userId);
    return { user: await this.users.toDto(user), profile: await this.users.getProfile(userId) };
  }

  /** 🔒 Sends a code that confirms account deletion (for accounts without a password, or instead of it). */
  @Post('delete/code')
  @HttpCode(202)
  deletionCode(@UserId() userId: string) {
    return this.auth.requestDeletionCode(userId);
  }

  /** 🔒 Permanently deletes the account. Body: { password } or { code }. */
  @Delete()
  @HttpCode(204)
  async deleteAccount(@UserId() userId: string, @Body() body: unknown) {
    this.limiter.hit(`delete:${userId}`, 10, 900);
    await this.auth.deleteAccount(userId, validate(DeleteAccountSchema, body));
  }

  @Patch('profile')
  async updateProfile(@UserId() userId: string, @Body() body: unknown) {
    const { assessmentId, ...patch } = validate(ProfilePatchSchema, body);
    await this.users.saveProfile(userId, patch, assessmentId);
    return this.me(userId);
  }
}
