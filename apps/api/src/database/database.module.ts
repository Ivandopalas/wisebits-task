import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectConnection, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppConfig } from '../config/config.service.js';

@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        uri: config.get('MONGO_URI'),
        serverSelectionTimeoutMS: 10_000,
      }),
    }),
  ],
})
export class DatabaseModule implements OnApplicationBootstrap {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Uniqueness rules (one conversation per pair, one message per client id) live in indexes,
   * so the instance must not take traffic before they exist.
   */
  async onApplicationBootstrap() {
    await Promise.all(Object.values(this.connection.models).map((model) => model.init()));
  }
}
