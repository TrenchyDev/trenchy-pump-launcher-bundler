import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
    }
  }
}

/** Extracts x-session-id from headers. Use before routes that need session-scoped vault. */
export function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  req.sessionId = (req.headers['x-session-id'] as string)?.trim() || undefined;
  next();
}
