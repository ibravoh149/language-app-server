import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AccessGuard, UserId } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { validate } from '../common/validate';
import { UsersService } from '../users/users.service';
import { AdminLlmService } from './admin-llm.service';
import { AdminOverviewService } from './admin-overview.service';
import { DaysSchema, LimitSchema } from './admin-query';
import { AdminUsersService } from './admin-users.service';
import { AdminGuard, AdminRequest, RequirePermission } from './admin.guard';
import { AuditService } from './audit.service';

const UsageQuery = z.object({ days: DaysSchema });
const CallsQuery = z.object({
  task: z.string().max(32).optional(),
  outcome: z.enum(['ok', 'invalid', 'error']).optional(),
  cursor: z.string().max(200).optional(),
  limit: LimitSchema,
});
const UsersQuery = z.object({ q: z.string().trim().max(100).optional(), cursor: z.string().max(200).optional(), limit: LimitSchema });
const AuditQuery = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(40).optional(),
  cursor: z.string().max(200).optional(),
  limit: LimitSchema,
});
const ReasonBody = z.object({ reason: z.string().trim().max(300).optional() });
const SuspendBody = z.object({ reason: z.string().trim().min(1, 'Give a reason.').max(300) });
const UserIdPipe = new ParseUUIDPipe({ exceptionFactory: () => new AppError('NOT_FOUND', 'User not found.') });

/** Admin dashboard. Contract: docs/api/admin.md. */
@Controller('admin')
@UseGuards(AccessGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly llm: AdminLlmService,
    private readonly overviewService: AdminOverviewService,
    private readonly adminUsers: AdminUsersService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  async me(@UserId() userId: string, @Req() req: AdminRequest) {
    const user = await this.users.requireUser(userId);
    return { user: { id: user.id, email: user.email, name: user.name }, ...req.admin! };
  }

  @Get('overview')
  @RequirePermission('analytics.read')
  async overview(@Query() query: unknown) {
    const { days } = validate(UsageQuery, query);
    return this.overviewService.overview(Math.max(7, days ?? 30));
  }

  @Get('llm/usage')
  @RequirePermission('llm.read')
  async llmUsage(@Query() query: unknown) {
    const { days } = validate(UsageQuery, query);
    return this.llm.usage(days ?? 30);
  }

  @Get('llm/calls')
  @RequirePermission('llm.read')
  async llmCalls(@Query() query: unknown) {
    const q = validate(CallsQuery, query);
    return this.llm.calls({ ...q, limit: q.limit ?? 25 });
  }

  @Get('users')
  @RequirePermission('users.read')
  async listUsers(@Query() query: unknown) {
    const q = validate(UsersQuery, query);
    return this.adminUsers.list({ q: q.q || undefined, cursor: q.cursor, limit: q.limit ?? 25 });
  }

  @Get('users/:id')
  @RequirePermission('users.read')
  async userDetail(@Param('id', UserIdPipe) id: string) {
    return this.adminUsers.detail(id);
  }

  @Post('users/:id/verify-email')
  @HttpCode(200)
  @RequirePermission('users.write')
  async verifyEmail(@UserId() actorId: string, @Param('id', UserIdPipe) id: string, @Body() body: unknown) {
    return { user: await this.adminUsers.verifyEmail(actorId, id, validate(ReasonBody, body).reason) };
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  @RequirePermission('users.write')
  async suspend(@UserId() actorId: string, @Param('id', UserIdPipe) id: string, @Body() body: unknown) {
    return { user: await this.adminUsers.suspend(actorId, id, validate(SuspendBody, body).reason) };
  }

  @Post('users/:id/unsuspend')
  @HttpCode(200)
  @RequirePermission('users.write')
  async unsuspend(@UserId() actorId: string, @Param('id', UserIdPipe) id: string, @Body() body: unknown) {
    return { user: await this.adminUsers.unsuspend(actorId, id, validate(ReasonBody, body).reason) };
  }

  @Delete('users/:id')
  @HttpCode(204)
  @RequirePermission('users.delete')
  async deleteUser(@UserId() actorId: string, @Param('id', UserIdPipe) id: string, @Body() body: unknown) {
    await this.adminUsers.remove(actorId, id, validate(ReasonBody, body).reason);
  }

  @Get('audit')
  @RequirePermission('audit.read')
  async auditLog(@Query() query: unknown) {
    const q = validate(AuditQuery, query);
    return this.audit.list({ ...q, limit: q.limit ?? 25 });
  }
}
