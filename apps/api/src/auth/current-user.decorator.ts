import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  username: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) {
    // Only reachable if a route marked @Public() asks for the user: a programming error.
    throw new Error('CurrentUser used on a route without authentication');
  }
  return user;
});
