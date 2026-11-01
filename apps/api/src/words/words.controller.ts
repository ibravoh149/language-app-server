import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { AccessGuard, UserId, VerifiedGuard } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { RateLimiter } from '../common/rate-limiter.service';
import { validate } from '../common/validate';
import { WordsService } from './words.service';

const SaveSchema = z.object({ lemma: z.string().trim().min(1, 'Enter a word.').max(80) });

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
