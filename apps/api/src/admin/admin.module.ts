import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAccessService } from './admin-access.service';
import { AdminLlmService } from './admin-llm.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminAccessService, AdminGuard, AdminLlmService, AdminOverviewService],
})
export class AdminModule {}
