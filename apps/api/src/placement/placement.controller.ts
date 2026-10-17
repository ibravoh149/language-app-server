import { Body, Controller, HttpCode, Ip, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { CEFR, LANGS } from '../auth/auth.schemas';
import { AppError } from '../common/app-error';
import { RateLimiter } from '../common/rate-limiter.service';
import { validate } from '../common/validate';
import { PlacementService } from './placement.service';

const CreateAttemptSchema = z.object({
  spokenLanguage: z.enum(LANGS),
  targetLanguage: z.literal('de'),
  selfRatedLevel: z.enum(CEFR).nullable().default(null),
});

const SubmitSchema = z
  .object({
    transcript: z.string().trim().max(1000).default(''),
    skipped: z.boolean().default(false),
  })
  .refine((v) => v.skipped || v.transcript.length > 0, { message: 'Say the sentence or skip.', path: ['transcript'] });

/** Public placement endpoints used during onboarding, before signup. Contract: docs/api/auth-onboarding.md */
@Controller('placement/attempts')
export class PlacementController {
  constructor(
    private readonly placement: PlacementService,
    private readonly limiter: RateLimiter,
  ) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @Ip() ip: string) {
    this.limiter.hit(`placement:create:${ip}`, 30, 3600);
    const input = validate(CreateAttemptSchema, body);
    return this.placement.createAttempt(input.spokenLanguage, input.targetLanguage, input.selfRatedLevel);
  }

  @Post(':id/submit')
  @HttpCode(200)
  async submit(
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new AppError('NOT_FOUND', 'This placement attempt does not exist.') }))
    id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    this.limiter.hit(`placement:submit:${ip}`, 30, 3600);
    const input = validate(SubmitSchema, body);
    return { result: await this.placement.submit(id, input.transcript, input.skipped) };
  }
}
