import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmClient } from '../llm/llm.client';
import { PlacementController } from './placement.controller';
import { PlacementService } from './placement.service';

@Module({
  imports: [AuthModule],
  controllers: [PlacementController],
  providers: [PlacementService, LlmClient],
})
export class PlacementModule {}
