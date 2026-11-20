import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';

/** Prevents caching successes and refusals, even if the shared body parser fails first. */
export function installOrganizationLogoCachePolicy(app: Pick<NestExpressApplication, 'use'>): void {
  const path = '/internal/v1/organization/logo';
  app.use(path, (_request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    path,
    (error: unknown, _request: Request, response: Response, next: NextFunction): void => {
      response.setHeader('Cache-Control', 'no-store');
      next(error);
    },
  );
}
