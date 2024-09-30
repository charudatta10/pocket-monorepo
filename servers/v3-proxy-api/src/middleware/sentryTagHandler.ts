import { NextFunction, Request, Response } from 'express';
import * as Sentry from '@sentry/node';
import { parseApiId } from '../utils';

/**
 * Middleware to add our Pocket API id to the request. Usually in the pocket apps this comes via our expressSentryMiddleware as headers in subgraphs,
 * but because this is a proxy that will eventually stand on its own and not come from Web repo we need to parse it here.
 * @param req
 * @param res
 * @param next
 * @returns
 */
export function sentryTagHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const consumerKey = req.query.consumer_key;
  if (consumerKey == null || typeof consumerKey !== 'string') {
    next();
    return;
  }
  const scope = Sentry.getCurrentScope();
  scope.setTag('pocket-api-id', parseApiId(consumerKey));

  next();
}
