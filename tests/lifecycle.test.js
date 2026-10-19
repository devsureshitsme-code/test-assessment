import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTaskService } from '../src/services/task.service.js';

const MISSING_ID = '3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e';

/** Steps (via the API) needed to bring a fresh task into each status. */
const PATH_TO = {
  pending: [],
  in_progress: ['in_progress'],
  completed: ['in_progress', 'completed'],
};

function createClock(start = '2026-01-01T00:00:00.000Z') {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    advance(ms = 60_000) {
      current += ms;
      return new Date(current).toISOString();
    },
    iso: () => new Date(current).toISOString(),
  };
}

describe('Task lifecycle', () => {
  let app;
  let clock;

  beforeEach(() => {
    clock = createClock();
    app = createApp({ env: 'test', taskService: createTaskService({ now: clock.now }) });
  });

  const setStatus = (id, status) =>
    request(app).patch(`/api/tasks/${id}/status`).send({ status });

  const getTask = async (id) => (await request(app).get(`/api/tasks/${id}`)).body.data;

  async function createTaskIn(status, fields = {}) {
    const created = await request(app)
      .post('/api/tasks')
      .send({ title: 'Lifecycle task', description: 'desc', priority: 'low', ...fields });
    expect(created.status).toBe(201);
    for (const step of PATH_TO[status]) {
      clock.advance();
      expect((await setStatus(created.body.data.id, step)).status).toBe(200);
    }
    return getTask(created.body.data.id);
  }

  describe('/api/tasks mount point', () => {
    it('serves the same tasks as the legacy /tasks path', async () => {
      const created = await request(app).post('/api/tasks').send({ title: 'Shared' });
      expect(created.headers.location).toBe(`/api/tasks/${created.body.data.id}`);

      const legacy = await request(app).get(`/tasks/${created.body.data.id}`);
      expect(legacy.status).toBe(200);
      expect(legacy.body.data).toEqual(created.body.data);
    });

    it('also exposes the status endpoint under /tasks', async () => {
      const task = await createTaskIn('pending');
      const res = await request(app)
        .patch(`/tasks/${task.id}/status`)
        .send({ status: 'in_progress' });
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /api/tasks/:id/status: permitted transitions', () => {
    it.each([
      ['pending', 'in_progress'],
      ['in_progress', 'completed'],
      ['in_progress', 'pending'],
    ])('%s -> %s returns 200 and the updated task', async (from, to) => {
      const before = await createTaskIn(from);
      const updatedAt = clock.advance();

      const res = await setStatus(before.id, to);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        ...before,
        status: to,
        updatedAt,
        completedAt: to === 'completed' ? updatedAt : null,
      });
      expect(await getTask(before.id)).toEqual(res.body.data);
    });

    it('supports a full round trip pending -> in_progress -> pending -> in_progress -> completed', async () => {
      const task = await createTaskIn('pending');
      for (const status of ['in_progress', 'pending', 'in_progress', 'completed']) {
        clock.advance();
        const res = await setStatus(task.id, status);
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(status);
      }
    });
  });

  describe('PATCH /api/tasks/:id/status: prohibited transitions', () => {
    it.each([
      ['pending', 'pending', ['in_progress'], "Cannot transition task from 'pending' to 'pending'"],
      ['pending', 'completed', ['in_progress'], "Cannot transition task from 'pending' to 'completed'"],
      ['in_progress', 'in_progress', ['completed', 'pending'], "Cannot transition task from 'in_progress' to 'in_progress'"],
      ['completed', 'pending', [], "Cannot change status of a completed task; 'completed' is a terminal status"],
      ['completed', 'in_progress', [], "Cannot change status of a completed task; 'completed' is a terminal status"],
      ['completed', 'completed', [], "Cannot change status of a completed task; 'completed' is a terminal status"],
    ])('%s -> %s returns 409 and leaves the task untouched', async (from, to, allowed, message) => {
      const before = await createTaskIn(from);
      clock.advance();

      const res = await setStatus(before.id, to);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message,
          details: { currentStatus: from, requestedStatus: to, allowedTransitions: allowed },
        },
      });
      expect(await getTask(before.id)).toEqual(before);
    });
  });

  describe('PATCH /api/tasks/:id/status: request validation', () => {
    it.each(['done', 'archived', 'COMPLETED', 'In_Progress', '', ' pending', 42, true, null, ['completed']])(
      'rejects unsupported status %j with 400',
      async (status) => {
        const before = await createTaskIn('in_progress');
        const res = await setStatus(before.id, status);

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details).toEqual([
          {
            location: 'body',
            field: 'status',
            message: 'Status must be one of: pending, in_progress, completed',
          },
        ]);
        expect(await getTask(before.id)).toEqual(before);
      },
    );

    it('rejects a missing status with 400', async () => {
      const task = await createTaskIn('pending');
      const res = await request(app).patch(`/api/tasks/${task.id}/status`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { location: 'body', field: 'status', message: 'Status is required' },
      ]);
    });

    it('rejects extra fields such as completedAt, without applying the status', async () => {
      const before = await createTaskIn('in_progress');
      const res = await request(app)
        .patch(`/api/tasks/${before.id}/status`)
        .send({ status: 'completed', completedAt: '1999-01-01T00:00:00.000Z' });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].message).toBe('Unknown field(s): completedAt');
      expect(await getTask(before.id)).toEqual(before);
    });

    it('rejects malformed JSON with 400', async () => {
      const task = await createTaskIn('pending');
      const res = await request(app)
        .patch(`/api/tasks/${task.id}/status`)
        .set('Content-Type', 'application/json')
        .send('{"status":');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });

    it('returns 404 for a nonexistent task', async () => {
      const res = await setStatus(MISSING_ID, 'in_progress');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', message: `Task with id '${MISSING_ID}' not found` },
      });
    });

    it('returns 400 (not 404) for an invalid status even when the task does not exist', async () => {
      const res = await setStatus(MISSING_ID, 'archived');
      expect(res.status).toBe(400);
    });

    it('returns 400 for a malformed task ID', async () => {
      const res = await setStatus('not-a-uuid', 'in_progress');
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        { location: 'params', field: 'id', message: 'Task ID must be a valid UUID' },
      ]);
    });

    it('returns 404 when the task ID segment is missing', async () => {
      const res = await request(app).patch('/api/tasks//status').send({ status: 'in_progress' });
      expect(res.status).toBe(404);
    });
  });

  describe('completedAt', () => {
    it('is null for newly created tasks', async () => {
      expect((await createTaskIn('pending')).completedAt).toBeNull();
    });

    it('stays null while a task moves between pending and in_progress', async () => {
      const task = await createTaskIn('in_progress');
      expect(task.completedAt).toBeNull();
      clock.advance();
      expect((await setStatus(task.id, 'pending')).body.data.completedAt).toBeNull();
    });

    it('is set to the transition time on completion and matches updatedAt', async () => {
      const task = await createTaskIn('in_progress');
      const completionTime = clock.advance();

      const res = await setStatus(task.id, 'completed');

      expect(res.body.data.completedAt).toBe(completionTime);
      expect(res.body.data.updatedAt).toBe(completionTime);
      expect(new Date(res.body.data.completedAt).getTime()).toBeGreaterThan(
        new Date(res.body.data.createdAt).getTime(),
      );
    });

    it('is not modified by failed transitions on an incomplete task', async () => {
      const task = await createTaskIn('pending');
      clock.advance();
      await setStatus(task.id, 'completed'); // prohibited: pending -> completed
      await setStatus(task.id, 'archived'); // unsupported
      expect((await getTask(task.id)).completedAt).toBeNull();
    });

    it('is not overwritten by repeated attempts to complete an already completed task', async () => {
      const completed = await createTaskIn('completed');
      const originalCompletedAt = completed.completedAt;
      expect(originalCompletedAt).not.toBeNull();

      for (let attempt = 0; attempt < 3; attempt++) {
        clock.advance();
        const res = await setStatus(completed.id, 'completed');
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      }

      expect(await getTask(completed.id)).toEqual(completed);
    });

    it('is not overwritten by unrelated updates to a completed task', async () => {
      const completed = await createTaskIn('completed');
      const editTime = clock.advance();

      const res = await request(app)
        .patch(`/api/tasks/${completed.id}`)
        .send({ title: 'Renamed after completion', description: 'notes', priority: 'high' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        ...completed,
        title: 'Renamed after completion',
        description: 'notes',
        priority: 'high',
        updatedAt: editTime,
      });
      expect(res.body.data.completedAt).toBe(completed.completedAt);
    });
  });

  describe('PATCH /api/tasks/:id: detail updates preserve lifecycle fields', () => {
    it.each(['pending', 'in_progress', 'completed'])(
      'updating the title of a %s task keeps status and completedAt',
      async (status) => {
        const before = await createTaskIn(status);
        clock.advance();

        const res = await request(app).patch(`/api/tasks/${before.id}`).send({ title: 'New title' });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe(status);
        expect(res.body.data.completedAt).toBe(before.completedAt);
      },
    );

    it('updates only the provided fields', async () => {
      const before = await createTaskIn('in_progress', {
        title: 'Original',
        description: 'Original description',
        priority: 'medium',
      });
      const editTime = clock.advance();

      const res = await request(app)
        .patch(`/api/tasks/${before.id}`)
        .send({ description: '  Revised description  ' });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        ...before,
        description: 'Revised description',
        updatedAt: editTime,
      });
    });

    it('rejects status changes through the general update endpoint', async () => {
      const before = await createTaskIn('in_progress');
      const res = await request(app)
        .patch(`/api/tasks/${before.id}`)
        .send({ title: 'Sneaky', status: 'completed' });

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].message).toBe(
        "Unknown field(s): status. Use PATCH /api/tasks/:id/status to change a task's status",
      );
      expect(await getTask(before.id)).toEqual(before);
    });

    it.each([['completedAt'], ['createdAt'], ['id'], ['updatedAt']])(
      'rejects attempts to set server-controlled field %s',
      async (field) => {
        const before = await createTaskIn('completed');
        const res = await request(app)
          .patch(`/api/tasks/${before.id}`)
          .send({ title: 'x', [field]: '2000-01-01T00:00:00.000Z' });

        expect(res.status).toBe(400);
        expect(await getTask(before.id)).toEqual(before);
      },
    );

    it('never partially applies an update when one field is invalid', async () => {
      const before = await createTaskIn('pending');
      const res = await request(app)
        .patch(`/api/tasks/${before.id}`)
        .send({ title: 'Valid new title', priority: 'urgent' });

      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.field)).toEqual(['priority']);
      expect(await getTask(before.id)).toEqual(before);
    });

    it.each([
      [{ title: '   ' }, 'Title must not be empty'],
      [{ title: 'a'.repeat(101) }, 'Title must be at most 100 characters'],
      [{ description: 'd'.repeat(1001) }, 'Description must be at most 1000 characters'],
    ])('applies the same field rules as creation: %j', async (body, message) => {
      const before = await createTaskIn('pending');
      const res = await request(app).patch(`/api/tasks/${before.id}`).send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.details[0].message).toBe(message);
      expect(await getTask(before.id)).toEqual(before);
    });

    it('rejects an empty update body', async () => {
      const task = await createTaskIn('pending');
      const res = await request(app).patch(`/api/tasks/${task.id}`).send({});

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        {
          location: 'body',
          field: null,
          message: 'At least one of title, description or priority must be provided',
        },
      ]);
    });

    it('returns 404 for a nonexistent task', async () => {
      const res = await request(app).patch(`/api/tasks/${MISSING_ID}`).send({ title: 'x' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for a malformed task ID', async () => {
      const res = await request(app).patch('/api/tasks/123').send({ title: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].field).toBe('id');
    });
  });

  describe('store isolation', () => {
    it('does not let callers mutate stored tasks through returned objects', () => {
      const service = createTaskService();
      const task = service.create({ title: 'Immutable' });

      task.status = 'completed';
      task.completedAt = 'tampered';
      service.getById(task.id).status = 'completed';

      expect(service.getById(task.id)).toMatchObject({ status: 'pending', completedAt: null });
    });

    it('leaves the stored task unchanged when updateStatus throws', () => {
      const service = createTaskService();
      const task = service.create({ title: 'Atomic' });

      expect(() => service.updateStatus(task.id, 'completed')).toThrow();
      expect(service.getById(task.id)).toEqual(task);
    });
  });
});
