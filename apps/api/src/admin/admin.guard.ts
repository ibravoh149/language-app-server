import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppError } from '../common/app-error';
import { AdminAccess, AdminAccessService } from './admin-access.service';
import { Permission } from './permissions';

const PERMISSION_KEY = 'admin:permission';

/** The permission an admin endpoint needs. Without it, any admin role is enough. */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

export type AdminRequest = Request & { userId?: string; admin?: AdminAccess };

/** 🛡 Requires an admin role (and the endpoint's permission). Use after AccessGuard. Sets `req.admin`. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly access: AdminAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const admin = await this.access.forUser(req.userId!);
    if (!admin.roles.length) throw new AppError('FORBIDDEN', 'This account has no admin access.');
    const needed = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (needed && !admin.permissions.includes(needed)) {
      throw new AppError('FORBIDDEN', `You need the ${needed} permission for this.`);
    }
    req.admin = admin;
    return true;
  }
}
