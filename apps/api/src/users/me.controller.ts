import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AccessGuard, UserId } from '../auth/auth.guard';
import { ProfilePatchSchema } from '../auth/auth.schemas';
import { validate } from '../common/validate';
import { UsersService } from './users.service';

/** The signed-in user's account and onboarding profile. */
@Controller('me')
@UseGuards(AccessGuard)
export class MeController {
  constructor(private readonly users: UsersService) {}

  /** 🔒 Works for unverified users too, so the app can route them to the verify screen. */
  @Get()
  async me(@UserId() userId: string) {
    const user = await this.users.requireUser(userId);
    return { user: await this.users.toDto(user), profile: await this.users.getProfile(userId) };
  }

  @Patch('profile')
  async updateProfile(@UserId() userId: string, @Body() body: unknown) {
    const { assessmentId, ...patch } = validate(ProfilePatchSchema, body);
    await this.users.saveProfile(userId, patch, assessmentId);
    return this.me(userId);
  }
}
