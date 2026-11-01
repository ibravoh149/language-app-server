import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmClient } from '../llm/llm.client';
import { WordsModule } from '../words/words.module';
import { RoleplayController } from './roleplay.controller';
import { RoleplayService } from './roleplay.service';
import { TutorService } from './tutor.service';

@Module({
  imports: [AuthModule, WordsModule],
  controllers: [RoleplayController],
  providers: [RoleplayService, TutorService, LlmClient],
})
export class RoleplayModule {}
