import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiDefaultResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  apiErrorSchema,
  authResponseSchema,
  loginSchema,
  meDtoSchema,
  registerSchema,
  type LoginInput,
  type RegisterInput,
} from '@chat/shared';
import type { Request, Response } from 'express';
import { AppConfig } from '../config/config.service.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './auth.cookies.js';
import { AuthService, type AuthResult } from './auth.service.js';
import { CurrentUser, type AuthUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';

@ApiTags('auth')
@ApiDefaultResponse({ description: 'Error', standardSchema: apiErrorSchema })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiCreatedResponse({ standardSchema: authResponseSchema })
  @Post('register')
  async register(
    @Body({ schema: registerSchema }) body: RegisterInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.register(body));
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @ApiOkResponse({ standardSchema: authResponseSchema })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(body));
  }

  @Public()
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiOkResponse({ standardSchema: authResponseSchema })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshToken(req);
    if (!token) {
      throw new UnauthorizedException('No active session');
    }
    try {
      return this.respond(res, await this.auth.refresh(token));
    } catch (error) {
      clearAuthCookies(res, this.config.get('COOKIE_SECURE'));
      throw error;
    }
  }

  @Public()
  @ApiCookieAuth(REFRESH_COOKIE)
  @ApiNoContentResponse()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = readRefreshToken(req);
    if (token) {
      await this.auth.logout(token);
    }
    clearAuthCookies(res, this.config.get('COOKIE_SECURE'));
  }

  @ApiBearerAuth()
  @ApiOkResponse({ standardSchema: meDtoSchema })
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  private respond(res: Response, result: AuthResult) {
    setAuthCookies(res, result.refresh, this.config.get('COOKIE_SECURE'));
    res.setHeader('Cache-Control', 'no-store');
    return result.response;
  }
}

function readRefreshToken(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
