import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AccessGuard, UserId } from '../auth/auth.guard';
import { UsersService } from '../users/users.service';
import { AdminGuard, AdminRequest } from './admin.guard';

/** Admin dashboard. Contract: docs/api/admin.md. */
@Controller('admin')
@UseGuards(AccessGuard, AdminGuard)
export class AdminController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@UserId() userId: string, @Req() req: AdminRequest) {
    const user = await this.users.requireUser(userId);
    return { user: { id: user.id, email: user.email, name: user.name }, ...req.admin! };
  }
}
