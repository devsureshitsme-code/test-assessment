import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createTaskService } from '../src/services/task.service.js';

function createFailingApp(env) {
  const taskService = createTaskService();
  taskService.list = () => {
    const err = new Error(
      `ECONNREFUSED connecting with DB_PASSWORD=${'s3cr3t'} at /srv/app/src/db/client.js:42`,
    );
    throw err;
  };
  const logger = { error: vi.fn() };
  return { app: createApp({ taskService, env, logger }), logger };
}

describe('Centralized error handling', () => {
  it('returns 404 with the standard shape for unknown routes', async () => {
    const res = await request(createApp({ env: 'test' })).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /does-not-exist not found' },
    });
  });

  it('returns 404 for unsupported methods on known paths', async () => {
    const res = await request(createApp({ env: 'test' })).delete('/tasks');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  describe.each(['production', 'test', undefined])('unexpected errors (NODE_ENV=%s)', (env) => {
    it('returns a generic 500 without leaking internals', async () => {
      const { app, logger } = createFailingApp(env);
      const res = await request(app).get('/tasks');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
      });

      const raw = res.text;
      expect(raw).not.toMatch(/s3cr3t|DB_PASSWORD|ECONNREFUSED|\/srv\/app|client\.js|stack/);
      expect(res.headers['x-powered-by']).toBeUndefined();

      // The real error is still logged server-side for operators.
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0][1]).toBeInstanceOf(Error);
    });
  });

  it('includes the stack trace only in development', async () => {
    const { app } = createFailingApp('development');
    const res = await request(app).get('/tasks');

    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('An unexpected error occurred');
    expect(res.body.error.stack).toEqual(expect.any(String));
  });

  it('does not log expected client errors', async () => {
    const logger = { error: vi.fn() };
    const app = createApp({ env: 'test', logger });

    await request(app).post('/tasks').send({});
    await request(app).get('/tasks/not-a-uuid');
    await request(app).post('/tasks').set('Content-Type', 'application/json').send('{bad');

    expect(logger.error).not.toHaveBeenCalled();
  });
});
