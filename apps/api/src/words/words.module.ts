import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmClient } from '../llm/llm.client';
import { DictionaryService } from './dictionary.service';
import { WordsController } from './words.controller';
import { WordsService } from './words.service';

@Module({
  imports: [AuthModule],
  controllers: [WordsController],
  providers: [WordsService, DictionaryService, LlmClient],
  exports: [WordsService],
})
export class WordsModule {}
