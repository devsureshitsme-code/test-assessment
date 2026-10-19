import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { DESCRIPTION_MAX_LENGTH, TITLE_MAX_LENGTH } from '../src/validation/task.schemas.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectErrorShape(res, status, code) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.body).toEqual({
    error: expect.objectContaining({ code, message: expect.any(String) }),
  });
}

function fieldErrors(res) {
  return res.body.error.details.map(({ field, message }) => ({ field, message }));
}

describe('Tasks API', () => {
  let app;

  beforeEach(() => {
    app = createApp({ env: 'test' });
  });

  describe('POST /tasks', () => {
    it('creates a task with only a title and applies defaults', async () => {
      const res = await request(app).post('/tasks').send({ title: 'Write report' });

      expect(res.status).toBe(201);
      expect(res.body.data).toEqual({
        id: expect.stringMatching(UUID_REGEX),
        title: 'Write report',
        description: null,
        priority: null,
        status: 'pending',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        completedAt: null,
      });
      expect(res.headers.location).toBe(`/tasks/${res.body.data.id}`);
    });

    it('creates a task with all optional fields', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: 'Deploy', description: 'Ship v2 to prod', priority: 'high' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        title: 'Deploy',
        description: 'Ship v2 to prod',
        priority: 'high',
        status: 'pending',
      });
    });

    it.each(['low', 'medium', 'high'])('accepts priority "%s"', async (priority) => {
      const res = await request(app).post('/tasks').send({ title: 'T', priority });
      expect(res.status).toBe(201);
      expect(res.body.data.priority).toBe(priority);
    });

    it('trims surrounding whitespace from title and description', async () => {
      const res = await request(app)
        .post('/tasks')
        .send({ title: '  Buy milk  ', description: '  2 litres  ' });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('Buy milk');
      expect(res.body.data.description).toBe('2 litres');
    });

    describe('title boundaries', () => {
      it('accepts a 1-character title', async () => {
        const res = await request(app).post('/tasks').send({ title: 'a' });
        expect(res.status).toBe(201);
      });

      it(`accepts a title of exactly ${TITLE_MAX_LENGTH} characters`, async () => {
        const title = 'a'.repeat(TITLE_MAX_LENGTH);
        const res = await request(app).post('/tasks').send({ title });
        expect(res.status).toBe(201);
        expect(res.body.data.title).toHaveLength(TITLE_MAX_LENGTH);
      });

      it(`rejects a title of ${TITLE_MAX_LENGTH + 1} characters`, async () => {
        const res = await request(app)
          .post('/tasks')
          .send({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) });

        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([
          { field: 'title', message: `Title must be at most ${TITLE_MAX_LENGTH} characters` },
        ]);
      });

      it('measures title length after trimming', async () => {
        const title = `  ${'a'.repeat(TITLE_MAX_LENGTH)}  `;
        const res = await request(app).post('/tasks').send({ title });
        expect(res.status).toBe(201);
      });
    });

    describe('description boundaries', () => {
      it('accepts an empty description', async () => {
        const res = await request(app).post('/tasks').send({ title: 'T', description: '' });
        expect(res.status).toBe(201);
        expect(res.body.data.description).toBe('');
      });

      it(`accepts a description of exactly ${DESCRIPTION_MAX_LENGTH} characters`, async () => {
        const description = 'd'.repeat(DESCRIPTION_MAX_LENGTH);
        const res = await request(app).post('/tasks').send({ title: 'T', description });
        expect(res.status).toBe(201);
        expect(res.body.data.description).toHaveLength(DESCRIPTION_MAX_LENGTH);
      });

      it(`rejects a description of ${DESCRIPTION_MAX_LENGTH + 1} characters`, async () => {
        const res = await request(app)
          .post('/tasks')
          .send({ title: 'T', description: 'd'.repeat(DESCRIPTION_MAX_LENGTH + 1) });

        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([
          {
            field: 'description',
            message: `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
          },
        ]);
      });

      it('rejects a non-string description', async () => {
        const res = await request(app).post('/tasks').send({ title: 'T', description: 42 });
        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([
          { field: 'description', message: 'Description must be a string' },
        ]);
      });
    });

    describe('title validation', () => {
      it('rejects a missing title', async () => {
        const res = await request(app).post('/tasks').send({ description: 'no title' });

        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(res.body.error.message).toBe('Request validation failed');
        expect(res.body.error.details).toEqual([
          { location: 'body', field: 'title', message: 'Title is required' },
        ]);
      });

      it('rejects an empty title', async () => {
        const res = await request(app).post('/tasks').send({ title: '' });
        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([{ field: 'title', message: 'Title must not be empty' }]);
      });

      it.each([' ', '     ', '\t\n  '])('rejects a whitespace-only title %j', async (title) => {
        const res = await request(app).post('/tasks').send({ title });
        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([{ field: 'title', message: 'Title must not be empty' }]);
      });

      it.each([123, true, null, ['a'], { text: 'a' }])(
        'rejects a non-string title %j',
        async (title) => {
          const res = await request(app).post('/tasks').send({ title });
          expectErrorShape(res, 400, 'VALIDATION_ERROR');
          expect(fieldErrors(res)).toEqual([{ field: 'title', message: 'Title must be a string' }]);
        },
      );
    });

    describe('priority validation', () => {
      it.each(['urgent', 'HIGH', '', 'Low', 1, null])(
        'rejects invalid priority %j',
        async (priority) => {
          const res = await request(app).post('/tasks').send({ title: 'T', priority });
          expectErrorShape(res, 400, 'VALIDATION_ERROR');
          expect(fieldErrors(res)).toEqual([
            { field: 'priority', message: 'Priority must be one of: low, medium, high' },
          ]);
        },
      );
    });

    describe('body shape', () => {
      it('reports every invalid field at once', async () => {
        const res = await request(app)
          .post('/tasks')
          .send({ title: '   ', priority: 'urgent', description: 5 });

        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(res.body.error.details.map((d) => d.field).sort()).toEqual([
          'description',
          'priority',
          'title',
        ]);
      });

      it('rejects client-supplied server-controlled fields such as status and id', async () => {
        const res = await request(app)
          .post('/tasks')
          .send({ title: 'T', status: 'done', id: 'abc' });

        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(res.body.error.details).toHaveLength(1);
        expect(res.body.error.details[0].message).toMatch(/status/);
        expect(res.body.error.details[0].message).toMatch(/id/);
      });

      it('rejects an empty JSON object', async () => {
        const res = await request(app).post('/tasks').send({});
        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([{ field: 'title', message: 'Title is required' }]);
      });

      it('rejects a JSON array body', async () => {
        const res = await request(app).post('/tasks').send([{ title: 'T' }]);
        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([
          { field: null, message: 'Request body must be a JSON object' },
        ]);
      });

      it('rejects a request with no body', async () => {
        const res = await request(app).post('/tasks');
        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(fieldErrors(res)).toEqual([
          { field: null, message: 'Request body must be a JSON object' },
        ]);
      });

      it('rejects a non-JSON content type', async () => {
        const res = await request(app)
          .post('/tasks')
          .set('Content-Type', 'text/plain')
          .send('title=hello');
        expectErrorShape(res, 400, 'VALIDATION_ERROR');
      });
    });

    describe('malformed JSON', () => {
      it.each(['{"title": "T"', '{title: "T"}', '{"title": "T",}', 'not json'])(
        'returns 400 INVALID_JSON for %j',
        async (payload) => {
          const res = await request(app)
            .post('/tasks')
            .set('Content-Type', 'application/json')
            .send(payload);

          expectErrorShape(res, 400, 'INVALID_JSON');
          expect(res.body.error.message).toBe('Request body contains malformed JSON');
          // The parser's raw message (which echoes input / positions) must not leak.
          expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|position/i);
        },
      );

      it('returns 413 for an oversized body', async () => {
        const res = await request(app)
          .post('/tasks')
          .send({ title: 'T', description: 'x'.repeat(200 * 1024) });
        expectErrorShape(res, 413, 'PAYLOAD_TOO_LARGE');
      });
    });
  });

  describe('GET /tasks', () => {
    it('returns an empty list initially', async () => {
      const res = await request(app).get('/tasks');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [] });
    });

    it('returns created tasks', async () => {
      await request(app).post('/tasks').send({ title: 'One' });
      await request(app).post('/tasks').send({ title: 'Two' });

      const res = await request(app).get('/tasks');
      expect(res.status).toBe(200);
      expect(res.body.data.map((t) => t.title)).toEqual(['One', 'Two']);
    });
  });

  describe('GET /tasks/:id', () => {
    it('returns an existing task', async () => {
      const created = await request(app).post('/tasks').send({ title: 'Find me' });
      const res = await request(app).get(`/tasks/${created.body.data.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(created.body.data);
    });

    it('returns 404 for a well-formed but nonexistent ID', async () => {
      const id = '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e';
      const res = await request(app).get(`/tasks/${id}`);

      expectErrorShape(res, 404, 'NOT_FOUND');
      expect(res.body.error.message).toBe(`Task with id '${id}' not found`);
    });

    it.each(['123', 'not-a-uuid', '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3', "1' OR '1'='1"])(
      'returns 400 for invalid ID %j',
      async (id) => {
        const res = await request(app).get(`/tasks/${encodeURIComponent(id)}`);

        expectErrorShape(res, 400, 'VALIDATION_ERROR');
        expect(res.body.error.details).toEqual([
          { location: 'params', field: 'id', message: 'Task ID must be a valid UUID' },
        ]);
      },
    );
  });
});
