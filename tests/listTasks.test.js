import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTaskService } from '../src/services/task.service.js';

const PRIORITY_CYCLE = ['low', 'medium', 'high', null];
const STATUS_CYCLE = ['pending', 'in_progress', 'completed'];
const LIFECYCLE_PATH = { pending: [], in_progress: ['in_progress'], completed: ['in_progress', 'completed'] };

describe('GET /api/tasks (filtering, sorting, pagination)', () => {
  let service;
  let app;
  let clockMs;

  beforeEach(() => {
    clockMs = Date.parse('2026-01-01T00:00:00.000Z');
    service = createTaskService({ now: () => new Date(clockMs) });
    app = createApp({ env: 'test', taskService: service });
  });

  /**
   * Creates `count` tasks one minute apart. Task i (1-based) is titled
   * "Task NN", with priority and status cycling through PRIORITY_CYCLE and
   * STATUS_CYCLE so every combination is represented.
   */
  function seed(count, { advanceClock = true } = {}) {
    return Array.from({ length: count }, (_, i) => {
      if (advanceClock) clockMs += 60_000;
      const priority = PRIORITY_CYCLE[i % PRIORITY_CYCLE.length];
      const status = STATUS_CYCLE[i % STATUS_CYCLE.length];
      let task = service.create({
        title: `Task ${String(i + 1).padStart(2, '0')}`,
        ...(priority && { priority }),
      });
      for (const step of LIFECYCLE_PATH[status]) task = service.updateStatus(task.id, step);
      return task;
    });
  }

  const list = (query = '') => request(app).get(`/api/tasks${query}`);
  const titles = (res) => res.body.data.map((t) => t.title);
  const range = (from, to) =>
    Array.from({ length: to - from + 1 }, (_, i) => `Task ${String(from + i).padStart(2, '0')}`);

  describe('response shape', () => {
    it('returns data and pagination metadata', async () => {
      const [task] = seed(1);
      const res = await list();

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [task],
        pagination: { page: 1, limit: 10, totalItems: 1, totalPages: 1 },
      });
    });

    it('is also served from the legacy /tasks path', async () => {
      seed(3);
      const legacy = await request(app).get('/tasks?limit=2&page=2');
      const current = await list('?limit=2&page=2');
      expect(legacy.status).toBe(200);
      expect(legacy.body).toEqual(current.body);
    });
  });

  describe('empty datasets', () => {
    it('returns an empty page with zero totals', async () => {
      const res = await list();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [],
        pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 0 },
      });
    });

    it('handles page > 1, filters and sorting on an empty dataset', async () => {
      const res = await list('?page=3&limit=5&status=completed&priority=high&sortBy=title&order=desc');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [],
        pagination: { page: 3, limit: 5, totalItems: 0, totalPages: 0 },
      });
    });

    it('returns an empty page when filters match nothing', async () => {
      seed(3); // statuses: pending, in_progress, completed; priorities: low, medium, high
      const res = await list('?status=pending&priority=high');
      expect(res.body).toEqual({
        data: [],
        pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 0 },
      });
    });
  });

  describe('pagination', () => {
    it('defaults to page 1, limit 10, oldest first', async () => {
      seed(25);
      const res = await list();

      expect(titles(res)).toEqual(range(1, 10));
      expect(res.body.pagination).toEqual({ page: 1, limit: 10, totalItems: 25, totalPages: 3 });
    });

    it('returns the requested page and limit', async () => {
      seed(25);
      const res = await list('?page=2&limit=5');

      expect(titles(res)).toEqual(range(6, 10));
      expect(res.body.pagination).toEqual({ page: 2, limit: 5, totalItems: 25, totalPages: 5 });
    });

    it('walks every page without gaps or overlaps; the last page may be short', async () => {
      seed(25);
      const all = titles(await list('?limit=100'));
      const pages = [];
      for (let page = 1; page <= 4; page++) {
        const res = await list(`?page=${page}&limit=7`);
        expect(res.body.pagination).toEqual({ page, limit: 7, totalItems: 25, totalPages: 4 });
        pages.push(titles(res));
      }

      expect(pages.map((p) => p.length)).toEqual([7, 7, 7, 4]);
      expect(pages.flat()).toEqual(all);
      expect(new Set(pages.flat()).size).toBe(25);
    });

    it('returns a full final page when totalItems divides evenly', async () => {
      seed(20);
      const res = await list('?page=2&limit=10');
      expect(titles(res)).toEqual(range(11, 20));
      expect(res.body.pagination.totalPages).toBe(2);
    });

    it.each([4, 5, 1000])('returns an empty data array for out-of-range page %i', async (page) => {
      seed(25);
      const res = await list(`?page=${page}&limit=10`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [],
        pagination: { page, limit: 10, totalItems: 25, totalPages: 3 },
      });
    });

    it('handles a very large (but safe) page number', async () => {
      seed(2);
      const page = Number.MAX_SAFE_INTEGER;
      const res = await list(`?page=${page}&limit=100`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.page).toBe(page);
    });

    it('supports limit=1', async () => {
      seed(3);
      const res = await list('?page=3&limit=1');
      expect(titles(res)).toEqual(['Task 03']);
      expect(res.body.pagination).toEqual({ page: 3, limit: 1, totalItems: 3, totalPages: 3 });
    });

    describe('maximum limit', () => {
      it('accepts limit=100 and returns at most 100 items', async () => {
        seed(150, { advanceClock: false });
        const res = await list('?limit=100');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(100);
        expect(res.body.pagination).toEqual({ page: 1, limit: 100, totalItems: 150, totalPages: 2 });

        const second = await list('?limit=100&page=2');
        expect(second.body.data).toHaveLength(50);
      });

      it.each(['101', '1000', '9007199254740991'])('rejects limit=%s with 400', async (limit) => {
        const res = await list(`?limit=${limit}`);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([
          { location: 'query', field: 'limit', message: 'limit must not exceed 100' },
        ]);
      });
    });
  });

  describe('filtering', () => {
    beforeEach(() => seed(24)); // 8 per status, 6 per priority, 2 per status+priority pair

    it.each([
      ['pending', 8],
      ['in_progress', 8],
      ['completed', 8],
    ])('filters by status=%s', async (status, expected) => {
      const res = await list(`?status=${status}&limit=100`);

      expect(res.body.data).toHaveLength(expected);
      expect(res.body.data.every((t) => t.status === status)).toBe(true);
      expect(res.body.pagination).toEqual({ page: 1, limit: 100, totalItems: expected, totalPages: 1 });
    });

    it.each(['low', 'medium', 'high'])('filters by priority=%s', async (priority) => {
      const res = await list(`?priority=${priority}&limit=100`);

      expect(res.body.data).toHaveLength(6);
      expect(res.body.data.every((t) => t.priority === priority)).toBe(true);
      expect(res.body.pagination.totalItems).toBe(6);
    });

    it('combines status and priority filters', async () => {
      const res = await list('?status=completed&priority=high&limit=100');

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((t) => t.status === 'completed' && t.priority === 'high')).toBe(true);
      const expected = (await list('?limit=100')).body.data.filter(
        (t) => t.status === 'completed' && t.priority === 'high',
      );
      expect(res.body.data).toEqual(expected);
      expect(res.body.pagination.totalItems).toBe(expected.length);
    });

    it('applies filters before pagination, and totals reflect the filtered set', async () => {
      const allPending = (await list('?status=pending&limit=100')).body.data;
      expect(allPending).toHaveLength(8);

      const page1 = await list('?status=pending&limit=3&page=1');
      const page3 = await list('?status=pending&limit=3&page=3');

      expect(page1.body.data).toEqual(allPending.slice(0, 3));
      expect(page3.body.data).toEqual(allPending.slice(6, 8));
      expect(page3.body.pagination).toEqual({ page: 3, limit: 3, totalItems: 8, totalPages: 3 });

      const unfiltered = await list('?limit=3');
      expect(unfiltered.body.pagination.totalItems).toBe(24);
    });

    it('combines filters with sorting and pagination', async () => {
      const res = await list('?status=pending&sortBy=title&order=desc&limit=2&page=2');
      const expected = (await list('?status=pending&limit=100')).body.data
        .map((t) => t.title)
        .sort()
        .reverse()
        .slice(2, 4);
      expect(titles(res)).toEqual(expected);
    });
  });

  describe('sorting', () => {
    it('sorts by createdAt ascending by default and descending on request', async () => {
      seed(5);
      expect(titles(await list())).toEqual(range(1, 5));
      expect(titles(await list('?sortBy=createdAt&order=asc'))).toEqual(range(1, 5));
      expect(titles(await list('?sortBy=createdAt&order=desc'))).toEqual(range(1, 5).reverse());
    });

    it('applies order to the default sort field when sortBy is omitted', async () => {
      seed(3);
      expect(titles(await list('?order=desc'))).toEqual(['Task 03', 'Task 02', 'Task 01']);
    });

    it('sorts by title in both directions', async () => {
      for (const title of ['banana', 'Cherry', 'apple']) service.create({ title });
      expect(titles(await list('?sortBy=title&order=asc'))).toEqual(['apple', 'banana', 'Cherry']);
      expect(titles(await list('?sortBy=title&order=desc'))).toEqual(['Cherry', 'banana', 'apple']);
    });

    it('sorts by priority rank with unprioritized tasks last', async () => {
      seed(8);
      const asc = (await list('?sortBy=priority&order=asc')).body.data.map((t) => t.priority);
      const desc = (await list('?sortBy=priority&order=desc')).body.data.map((t) => t.priority);
      expect(asc).toEqual(['low', 'low', 'medium', 'medium', 'high', 'high', null, null]);
      expect(desc).toEqual(['high', 'high', 'medium', 'medium', 'low', 'low', null, null]);
    });

    it('sorts by status in lifecycle order', async () => {
      seed(6);
      const asc = (await list('?sortBy=status')).body.data.map((t) => t.status);
      expect(asc).toEqual(['pending', 'pending', 'in_progress', 'in_progress', 'completed', 'completed']);
      const desc = (await list('?sortBy=status&order=desc')).body.data.map((t) => t.status);
      expect(desc).toEqual([...asc].reverse());
    });

    it('sorts by completedAt with incomplete tasks last in both directions', async () => {
      seed(6); // Task 03 and Task 06 are completed
      expect(titles(await list('?sortBy=completedAt&order=asc')).slice(0, 2)).toEqual(['Task 03', 'Task 06']);
      expect(titles(await list('?sortBy=completedAt&order=desc')).slice(0, 2)).toEqual(['Task 06', 'Task 03']);
      const tail = (await list('?sortBy=completedAt')).body.data.slice(2);
      expect(tail.every((t) => t.completedAt === null)).toBe(true);
    });

    it('sorts by updatedAt', async () => {
      const [first, second] = seed(2);
      clockMs += 60_000;
      service.update(first.id, { title: 'Task 01 (edited)' });

      expect((await list('?sortBy=updatedAt&order=desc')).body.data.map((t) => t.id)).toEqual([
        first.id,
        second.id,
      ]);
    });

    it('breaks ties deterministically using creation order', async () => {
      // All created in the same millisecond, all with priority "high".
      const created = ['C', 'A', 'B'].map((title) => service.create({ title, priority: 'high' }));
      const expectedAsc = created.map((t) => t.id);

      const asc = await list('?sortBy=priority&order=asc');
      const desc = await list('?sortBy=priority&order=desc');
      expect(asc.body.data.map((t) => t.id)).toEqual(expectedAsc);
      expect(desc.body.data.map((t) => t.id)).toEqual([...expectedAsc].reverse());

      const createdAtAsc = await list('?sortBy=createdAt');
      expect(createdAtAsc.body.data.map((t) => t.id)).toEqual(expectedAsc);
    });

    it('keeps page boundaries stable when many tasks share a sort value', async () => {
      seed(30, { advanceClock: false });
      const pages = [];
      for (let page = 1; page <= 3; page++) {
        pages.push(titles(await list(`?sortBy=status&limit=10&page=${page}`)));
      }
      expect(new Set(pages.flat()).size).toBe(30);
      // Repeating the same request yields the same result.
      expect(titles(await list('?sortBy=status&limit=10&page=2'))).toEqual(pages[1]);
    });

    it.each([
      'id',
      'description',
      'password',
      '__proto__',
      'constructor',
      'toString',
      'title;DROP TABLE tasks',
      'createdAt,title',
      '-createdAt',
      'CreatedAt',
      'title.length',
    ])('rejects unsupported sortBy=%j with 400', async (sortBy) => {
      seed(2);
      const res = await list(`?sortBy=${encodeURIComponent(sortBy)}`);

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([
        {
          location: 'query',
          field: 'sortBy',
          message: 'sortBy must be one of: createdAt, updatedAt, completedAt, title, priority, status',
        },
      ]);
    });
  });

  describe('immutability', () => {
    it('does not reorder or modify the stored collection', async () => {
      const created = seed(6);
      await list('?sortBy=title&order=desc');
      await list('?status=pending&priority=low&page=2&limit=1');
      await list('?sortBy=priority&order=desc&limit=3');

      const { data } = service.list({ limit: 100 });
      expect(data).toEqual(created);
    });

    it('returns copies, so changing a listed task does not affect the store', () => {
      const [task] = seed(1);
      service.list().data[0].status = 'completed';
      expect(service.getById(task.id).status).toBe(task.status);
    });
  });

  describe('invalid query parameters', () => {
    it.each([
      ['page=0', 'page', 'page must be a positive integer'],
      ['page=-1', 'page', 'page must be a positive integer'],
      ['page=1.5', 'page', 'page must be a positive integer'],
      ['page=abc', 'page', 'page must be a positive integer'],
      ['page=', 'page', 'page must be a positive integer'],
      ['page=01', 'page', 'page must be a positive integer'],
      ['page=1e2', 'page', 'page must be a positive integer'],
      ['page=0x10', 'page', 'page must be a positive integer'],
      ['page=%201', 'page', 'page must be a positive integer'],
      ['page=99999999999999999999', 'page', 'page is too large'],
      ['limit=0', 'limit', 'limit must be a positive integer'],
      ['limit=-5', 'limit', 'limit must be a positive integer'],
      ['limit=ten', 'limit', 'limit must be a positive integer'],
      ['limit=', 'limit', 'limit must be a positive integer'],
      ['status=done', 'status', 'status must be one of: pending, in_progress, completed'],
      ['status=PENDING', 'status', 'status must be one of: pending, in_progress, completed'],
      ['status=', 'status', 'status must be one of: pending, in_progress, completed'],
      ['priority=urgent', 'priority', 'priority must be one of: low, medium, high'],
      ['priority=null', 'priority', 'priority must be one of: low, medium, high'],
      ['order=ascending', 'order', 'order must be one of: asc, desc'],
      ['order=DESC', 'order', 'order must be one of: asc, desc'],
      ['status=pending&status=completed', 'status', 'status must be provided only once'],
      ['page=1&page=2', 'page', 'page must be provided only once'],
    ])('?%s returns 400', async (query, field, message) => {
      const res = await list(`?${query}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([{ location: 'query', field, message }]);
    });

    it.each(['foo=bar', 'search=x', 'offset=10', 'filter[status]=pending'])(
      'rejects unknown parameter ?%s',
      async (query) => {
        const res = await list(`?${query}`);
        expect(res.status).toBe(400);
        expect(res.body.error.details).toEqual([
          {
            location: 'query',
            field: null,
            message: `Unknown query parameter(s): ${decodeURIComponent(query.split('=')[0])}`,
          },
        ]);
      },
    );

    it('reports every invalid parameter at once', async () => {
      const res = await list('?page=0&limit=500&status=x&priority=y&sortBy=id&order=up');
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d) => d.field).sort()).toEqual([
        'limit', 'order', 'page', 'priority', 'sortBy', 'status',
      ]);
    });
  });
});
