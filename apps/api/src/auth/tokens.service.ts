import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/config.service.js';
import type { AuthUser } from './current-user.decorator.js';

const ACCESS_AUDIENCE = 'access';
const MEDIA_AUDIENCE = 'story-media';

export class TokenExpiredException extends UnauthorizedException {
  constructor() {
    super({ message: 'Access token expired', details: { code: 'TOKEN_EXPIRED' } });
  }
}

/**
 * Access tokens and story media tokens share the signing key, so each kind carries its own
 * audience and a token of one kind is rejected where the other is expected.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  get accessTokenTtl(): number {
    return this.config.get('ACCESS_TOKEN_TTL_SECONDS');
  }

  signAccess(user: AuthUser): Promise<string> {
    return this.jwt.signAsync(
      { username: user.username },
      { subject: user.id, audience: ACCESS_AUDIENCE, expiresIn: this.accessTokenTtl },
    );
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    const payload = await this.verify<{ sub: string; username: string }>(token, ACCESS_AUDIENCE);
    return { id: payload.sub, username: payload.username };
  }

  /** Grants one user access to one story video until the earlier of the TTL and story expiry. */
  signMedia(storyId: string, userId: string, storyExpiresAt: Date): Promise<string> {
    const ttl = Math.min(
      this.config.get('MEDIA_TOKEN_TTL_SECONDS'),
      Math.floor((storyExpiresAt.getTime() - Date.now()) / 1000),
    );
    return this.jwt.signAsync(
      { story: storyId },
      { subject: userId, audience: MEDIA_AUDIENCE, expiresIn: Math.max(ttl, 1) },
    );
  }

  async verifyMedia(token: string, storyId: string): Promise<void> {
    const payload = await this.verify<{ story: string }>(token, MEDIA_AUDIENCE);
    if (payload.story !== storyId) {
      throw new UnauthorizedException('Invalid media token');
    }
  }

  private async verify<T extends object>(token: string, audience: string): Promise<T> {
    try {
      return await this.jwt.verifyAsync<T>(token, { audience });
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new TokenExpiredException();
      }
      throw new UnauthorizedException('Invalid token');
    }
  }
}
