import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { AppConfig } from '../config/config.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { Session } from './session.schema.js';

/**
 * A rotated token presented again within this window is treated as a race between the user's
 * own requests (two tabs, a retry after a lost response), not as theft.
 */
export const REUSE_GRACE_MS = 10_000;

export interface IssuedRefreshToken {
  token: string;
  familyId: string;
  expiresAt: Date;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly config: AppConfig,
    private readonly realtime: RealtimeService,
  ) {}

  start(userId: Types.ObjectId): Promise<IssuedRefreshToken> {
    return this.issue(userId, randomUUID());
  }

  async rotate(token: string): Promise<{ userId: Types.ObjectId; refresh: IssuedRefreshToken }> {
    const tokenHash = hashToken(token);
    const now = new Date();

    // Atomic claim: of two concurrent refreshes with the same token only one gets here.
    const claimed = await this.sessions
      .findOneAndUpdate(
        { tokenHash, rotatedAt: null, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { rotatedAt: now } },
      )
      .lean()
      .exec();
    if (claimed) {
      return {
        userId: claimed.userId,
        refresh: await this.issue(claimed.userId, claimed.familyId),
      };
    }

    const session = await this.sessions.findOne({ tokenHash }).lean().exec();
    if (!session || session.revokedAt || session.expiresAt <= now || !session.rotatedAt) {
      throw invalidSession();
    }
    if (now.getTime() - session.rotatedAt.getTime() <= REUSE_GRACE_MS) {
      return {
        userId: session.userId,
        refresh: await this.issue(session.userId, session.familyId),
      };
    }

    await this.revokeFamily(session.familyId);
    this.logger.warn(
      { userId: session.userId.toString() },
      'Refresh token reuse detected, session family revoked',
    );
    throw invalidSession();
  }

  async revoke(token: string): Promise<void> {
    const session = await this.sessions
      .findOne({ tokenHash: hashToken(token) })
      .lean()
      .exec();
    if (session) {
      await this.revokeFamily(session.familyId);
    }
  }

  /** False once the user signed out of the session or it was revoked after a reuse. */
  async isActive(familyId: string): Promise<boolean> {
    return (await this.sessions.exists({ familyId, revokedAt: null })) !== null;
  }

  private async issue(userId: Types.ObjectId, familyId: string): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000);
    await this.sessions.create({ userId, familyId, tokenHash: hashToken(token), expiresAt });
    return { token, familyId, expiresAt };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.sessions.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    this.realtime.disconnectSession(familyId);
  }
}

function invalidSession() {
  return new UnauthorizedException('Session expired, please sign in again');
}
