import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import type { Connection } from 'mongoose';
import type { Server, ServerOptions } from 'socket.io';

export const ADAPTER_COLLECTION = 'socket.io-adapter-events';
const NAMESPACE_EXISTS = 48;

/**
 * Socket.io across API replicas through MongoDB. Each instance writes the events it broadcasts
 * into a capped collection and tails it with a change stream (cursor tailing over the oplog),
 * so an emit to a room reaches sockets connected to any instance. The capped size bounds the
 * collection without a TTL sweep.
 */
export class MongoIoAdapter extends IoAdapter {
  private adapter: ReturnType<typeof createAdapter> | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connect(connection: Connection): Promise<void> {
    const db = connection.db!;
    try {
      await db.createCollection(ADAPTER_COLLECTION, { capped: true, size: 1_000_000 });
    } catch (error) {
      // Another replica created it first.
      if ((error as { code?: number }).code !== NAMESPACE_EXISTS) {
        throw error;
      }
    }
    this.adapter = createAdapter(db.collection(ADAPTER_COLLECTION) as never);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapter) {
      server.adapter(this.adapter);
    }
    return server;
  }
}
