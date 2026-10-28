import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfig } from '../config/config.service.js';
import { UsersModule } from '../users/users.module.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { Session, SessionSchema } from './session.schema.js';
import { SessionsService } from './sessions.service.js';
import { TokensService } from './tokens.service.js';

@Global()
@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    JwtModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    // In-memory counters are per instance; nginx applies the shared limit in front of all replicas.
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'auth', ttl: 60_000, limit: config.get('AUTH_RATE_LIMIT_PER_MINUTE') },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    TokensService,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
  exports: [TokensService],
})
export class AuthModule {}
