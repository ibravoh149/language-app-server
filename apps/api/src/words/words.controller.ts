import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { AccessGuard, UserId, VerifiedGuard } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { RateLimiter } from '../common/rate-limiter.service';
import { validate } from '../common/validate';
import { WordsService } from './words.service';

const SaveSchema = z.object({ lemma: z.string().trim().min(1, 'Enter a word.').max(80) });
const LookupSchema = z.object({
  q: z.string().trim().min(1, 'Enter a word.').max(60),
  // The whole AI reply is fine; only the first 300 characters go to the dictionary prompt.
  context: z.string().trim().max(2000).transform((s) => s.slice(0, 300)).optional(),
});

/** My Words. Contract: docs/api/roleplay.md (v3). */
@Controller('me/words')
@UseGuards(AccessGuard, VerifiedGuard)
export class WordsController {
  constructor(
    private readonly words: WordsService,
    private readonly limiter: RateLimiter,
  ) {}

  @Get()
  async list(@UserId() userId: string) {
    return { words: await this.words.list(userId) };
  }

  /** Look a word up without saving it (tap-a-word). `q` may be inflected; the answer is its lemma. */
  @Get('lookup')
  async lookup(@UserId() userId: string, @Query() query: unknown) {
    const { q, context } = validate(LookupSchema, query);
    // Cached words are free, but an uncached one is an LLM call (D10).
    this.limiter.hit(`words-lookup:${userId}`, 300, 3600);
    const entry = await this.words.lookup(userId, q, context || undefined);
    return { word: await this.words.describe(userId, entry) };
  }

  /** 201 when newly saved, 200 when it was already in the list. */
  @Post()
  async save(@UserId() userId: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { lemma } = validate(SaveSchema, body);
    this.limiter.hit(`words-save:${userId}`, 120, 3600);
    const entry = await this.words.lookup(userId, lemma);
    const { word, created } = await this.words.save(userId, entry, 'manual');
    res.status(created ? 201 : 200);
    return { word };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @UserId() userId: string,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => new AppError('NOT_FOUND', 'This word is not in your list.') })) id: string,
  ) {
    await this.words.remove(userId, id);
  }
}
