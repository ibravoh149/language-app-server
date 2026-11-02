import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAccessService } from './admin-access.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminAccessService, AdminGuard],
})
export class AdminModule {}
