import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Logs one line per request when it finishes:
 *   POST /api/v1/auth/login 401 INVALID_CREDENTIALS 38ms ip=192.168.0.42 user=3f2a…
 * Bodies and query strings are never logged (passwords, codes, tokens). The error
 * code comes from ErrorFilter via res.locals. Set LOG_REQUESTS=false to turn it off.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  private readonly enabled = process.env.LOG_REQUESTS !== 'false';

  use(req: Request & { userId?: string }, res: Response, next: NextFunction) {
    if (!this.enabled) return next();
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const path = req.originalUrl.split('?')[0];
      const parts = [req.method, path, String(res.statusCode)];
      if (res.locals.errorCode) parts.push(res.locals.errorCode);
      parts.push(`${ms.toFixed(0)}ms`, `ip=${req.ip?.replace(/^::ffff:/, '')}`);
      if (req.userId) parts.push(`user=${req.userId.slice(0, 8)}…`);
      const line = parts.join(' ');
      if (res.statusCode >= 500) this.logger.error(line);
      else if (res.statusCode >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });
    next();
  }
}
