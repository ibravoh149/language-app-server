import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AccessGuard, UserId, VerifiedGuard } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { RoleplayService } from './roleplay.service';

const StartSchema = z.object({ scenarioId: z.string().trim().min(1).max(100) });
const TurnSchema = z.object({
  text: z.string().trim().min(1, 'Say or type something first.').max(500),
  inputMode: z.enum(['voice', 'text']).default('text'),
  /** Idempotency key: the same id on a retry replays the stored response. */
  clientTurnId: z.string().uuid('clientTurnId must be a UUID.').optional(),
});

/** Roleplay conversation. Contract: docs/api/roleplay.md. Every route: ✅ verified email. */
@Controller()
@UseGuards(AccessGuard, VerifiedGuard)
export class RoleplayController {
  constructor(private readonly roleplay: RoleplayService) {}

  @Get('scenarios')
  async scenarios(@UserId() userId: string) {
    return { scenarios: await this.roleplay.listScenarios(userId) };
  }

  @Get('scenarios/:idOrSlug')
  async scenario(@UserId() userId: string, @Param('idOrSlug') idOrSlug: string) {
    return { scenario: await this.roleplay.getScenario(userId, idOrSlug) };
  }

  @Post('sessions')
  @HttpCode(201)
  start(@UserId() userId: string, @Body() body: unknown) {
    return this.roleplay.startSession(userId, validate(StartSchema, body).scenarioId);
  }

  @Post('sessions/:id/turns')
  @HttpCode(200)
  turn(@UserId() userId: string, @Param('id') id: string, @Body() body: unknown) {
    const { text, inputMode, clientTurnId } = validate(TurnSchema, body);
    return this.roleplay.takeTurn(userId, id, text, inputMode, clientTurnId);
  }

  @Get('sessions/:id')
  session(@UserId() userId: string, @Param('id') id: string) {
    return this.roleplay.getSession(userId, id);
  }

  @Get('sessions/:id/corrections')
  corrections(@UserId() userId: string, @Param('id') id: string) {
    return this.roleplay.getCorrections(userId, id);
  }

  @Post('sessions/:id/end')
  @HttpCode(200)
  end(@UserId() userId: string, @Param('id') id: string) {
    return this.roleplay.endSession(userId, id);
  }

  @Get('me/progress')
  progress(@UserId() userId: string) {
    return this.roleplay.getProgress(userId);
  }
}
