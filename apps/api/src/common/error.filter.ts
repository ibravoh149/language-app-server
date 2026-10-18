import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppError, ErrorCode } from './app-error';

const HTTP_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  429: 'RATE_LIMITED',
};

/** Renders every error as `{ error: { code, message, fields? } }`. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof AppError) {
      res.locals.errorCode = exception.code;
      if (exception.options.retryAfterSec) res.setHeader('Retry-After', String(exception.options.retryAfterSec));
      res.status(exception.status).json({
        error: { code: exception.code, message: exception.message, ...(exception.options.fields && { fields: exception.options.fields }) },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = HTTP_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED');
      res.locals.errorCode = code;
      res.status(status).json({ error: { code, message: exception.message } });
      return;
    }

    res.locals.errorCode = 'INTERNAL';
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  }
}
