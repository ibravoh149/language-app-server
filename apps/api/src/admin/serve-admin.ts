import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import express, { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Serves the admin dashboard's static build at /admin (D28). The build comes from
 * languageapp-web (apps/admin/dist); set ADMIN_DIST_DIR in production. Hashed assets are
 * cached for a year, index.html never, and unknown /admin/* paths fall back to index.html
 * for client-side routing. Without a build, /admin answers 404.
 */
export function serveAdmin(app: NestExpressApplication) {
  const logger = new Logger('Admin');
  // dist/admin/serve-admin.js → languageapp/languageapp-web/apps/admin/dist in the dev workspace
  const dir = resolve(process.env.ADMIN_DIST_DIR ?? join(__dirname, '../../../../../languageapp-web/apps/admin/dist'));
  const index = join(dir, 'index.html');
  logger.log(`serving /admin from ${dir}${existsSync(index) ? '' : ' (no build yet)'}`);

  const notFound = (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  };
  app.use('/admin/assets', express.static(join(dir, 'assets'), { immutable: true, maxAge: '365d' }), notFound);
  app.use('/admin', express.static(dir, { index: false, maxAge: '1h' }));
  app.use('/admin', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!existsSync(index)) return notFound(req, res);
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
