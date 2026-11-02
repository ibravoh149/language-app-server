import { CanActivate, createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppError } from '../common/app-error';
import { requestContext } from '../common/request-context';
import { UsersService } from '../users/users.service';
import { TokensService } from './tokens.service';

type AuthedRequest = Request & { userId?: string };

/** 🔒 Requires a valid access token. Sets `req.userId`. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new AppError('UNAUTHORIZED', 'Sign in to continue.');
    req.userId = await this.tokens.verifyAccess(token);
    // Access tokens live for minutes; a suspension must take effect on the next call.
    if (await this.tokens.isSuspended(req.userId)) {
      throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended. Contact support if you think this is a mistake.');
    }
    const context = requestContext.getStore();
    if (context) context.userId = req.userId;
    return true;
  }
}

/** ✅ Requires a verified email. Use after AccessGuard. */
@Injectable()
export class VerifiedGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = await this.users.requireUser(req.userId!);
    if (!user.emailVerifiedAt) throw new AppError('EMAIL_NOT_VERIFIED', 'Verify your email to continue.');
    return true;
  }
}

/** The authenticated user's id (set by AccessGuard). */
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().userId);
