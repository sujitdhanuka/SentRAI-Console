import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentUser as CurrentUserType } from '../interfaces/current-user.interface';

/** Injects the authenticated user (populated by JwtStrategy) into a handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserType => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
