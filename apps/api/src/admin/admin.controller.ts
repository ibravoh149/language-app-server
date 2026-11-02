import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AccessGuard, UserId } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { UsersService } from '../users/users.service';
import { AdminLlmService } from './admin-llm.service';
import { DaysSchema, LimitSchema } from './admin-query';
import { AdminGuard, AdminRequest, RequirePermission } from './admin.guard';

const UsageQuery = z.object({ days: DaysSchema });
const CallsQuery = z.object({
  task: z.string().max(32).optional(),
  outcome: z.enum(['ok', 'invalid', 'error']).optional(),
  cursor: z.string().max(200).optional(),
  limit: LimitSchema,
});

/** Admin dashboard. Contract: docs/api/admin.md. */
@Controller('admin')
@UseGuards(AccessGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly users: UsersService,
    private readonly llm: AdminLlmService,
  ) {}

  @Get('me')
  async me(@UserId() userId: string, @Req() req: AdminRequest) {
    const user = await this.users.requireUser(userId);
    return { user: { id: user.id, email: user.email, name: user.name }, ...req.admin! };
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
}
