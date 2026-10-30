import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/mongo-adapter';
import type { Connection } from 'mongoose';
import type { Server, ServerOptions } from 'socket.io';

export const ADAPTER_COLLECTION = 'socket.io-adapter-events';
const NAMESPACE_EXISTS = 48;

// The adapter has no "leaving" message: a stopped or crashed instance stays in the others'
// view until its heartbeats are overdue, and requests wait for its answer until they time out.
// The defaults (5 s heartbeats, 10 s to give up on a node, 5 s per request) make a rolling
// restart visible to users; these keep both windows short.
const CLUSTER_TIMING = { heartbeatInterval: 2000, heartbeatTimeout: 5000, requestsTimeout: 2000 };

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
    // A fresh object: createAdapter writes the node's uid into the options it is given.
    this.adapter = createAdapter(db.collection(ADAPTER_COLLECTION), { ...CLUSTER_TIMING });
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapter) {
      server.adapter(this.adapter);
    }
    return server;
  }
}
