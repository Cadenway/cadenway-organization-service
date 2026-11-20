import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/** Protects Search authority reads and errors from caching and freshness shortcuts. */
export function installOrganizationSearchCachePolicy(
  app: Pick<NestExpressApplication, 'use'>,
): void {
  const path = /^\/internal\/v1\/search-(?:organizations|membership)\/?$/iu;
  app.use(path, (request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'private, no-store');
    if (request.method === 'GET' || request.method === 'HEAD') {
      delete request.headers['if-none-match'];
      delete request.headers['if-modified-since'];
    }
    next();
  });
  app.use(
    path,
    (error: unknown, _request: Request, response: Response, next: NextFunction): void => {
      response.setHeader('Cache-Control', 'private, no-store');
      next(error);
    },
  );
}
