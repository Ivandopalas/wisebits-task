import { Injectable, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { AuthResponse, LoginInput, MeDto, RegisterInput } from '@chat/shared';
import * as argon2 from 'argon2';
import type { Types } from 'mongoose';
import { toMeDto } from '../users/user.mapper.js';
import type { User } from '../users/user.schema.js';
import { UsersService } from '../users/users.service.js';
import { SessionsService, type IssuedRefreshToken } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

/** OWASP baseline for argon2id: 19 MiB, 2 passes, 1 lane. */
const HASH_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export interface AuthResult {
  response: AuthResponse;
  refresh: IssuedRefreshToken;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Verified against for unknown emails, so both failure paths take the same time. */
  private dummyHash = '';

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokensService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await argon2.hash('timing-equalizer', HASH_OPTIONS);
  }

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await argon2.hash(input.password, HASH_OPTIONS);
    const user = await this.users.create({
      email: input.email,
      username: input.username,
      passwordHash,
    });
    return this.startSession(user);
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.users.findByEmailWithPassword(input.email);
    const valid = await argon2.verify(user?.passwordHash ?? this.dummyHash, input.password);
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.startSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const { userId, refresh } = await this.sessions.rotate(refreshToken);
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }
    return { response: await this.buildResponse(user), refresh };
  }

  logout(refreshToken: string): Promise<void> {
    return this.sessions.revoke(refreshToken);
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return toMeDto(user);
  }

  private async startSession(user: User & { _id: Types.ObjectId }): Promise<AuthResult> {
    const refresh = await this.sessions.start(user._id);
    return { response: await this.buildResponse(user), refresh };
  }

  private async buildResponse(user: User): Promise<AuthResponse> {
    const accessToken = await this.tokens.signAccess({
      id: user._id.toString(),
      username: user.username,
    });
    return { accessToken, expiresIn: this.tokens.accessTokenTtl, user: toMeDto(user) };
  }
}
