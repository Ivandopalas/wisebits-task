import request from 'supertest';
import { createTestApp, type TestApp } from './helpers/app.js';

interface Operation {
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

describe('OpenAPI document', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  it('describes the body of every successful response and of errors', async () => {
    const { body } = await request(t.url).get('/api/docs-json').expect(200);
    const paths = body.paths as Record<string, Record<string, Operation>>;

    const undocumented: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        for (const [status, response] of Object.entries(operation.responses)) {
          const hasBody = /^2/.test(status) && status !== '204';
          const schemas = Object.values(response.content ?? {}).map((c) => c.schema);
          if (hasBody && (schemas.length === 0 || schemas.some((s) => !s))) {
            undocumented.push(`${method.toUpperCase()} ${path} ${status}`);
          }
        }
      }
    }
    expect(undocumented).toEqual([]);

    const schemas = body.components.schemas as Record<string, { properties?: object }>;
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(['ApiError', 'Conversation', 'Message', 'Story', 'User']),
    );
    expect(schemas.Conversation!.properties).toHaveProperty('peerLastReadSeq');
    expect(paths['/api/conversations']!.get!.responses.default).toBeDefined();
  });
});
