import { describe, expect, it } from 'vitest';
import {
  SORTABLE_FIELDS,
  filterTasks,
  paginate,
  sortTasks,
} from '../src/domain/taskQuery.js';

const task = (id, overrides = {}) => ({
  id,
  title: `Task ${id}`,
  description: null,
  priority: null,
  status: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: null,
  ...overrides,
});

const ids = (tasks) => tasks.map((t) => t.id);

/** Deep-freezes an array of tasks so any in-place mutation throws. */
const frozen = (tasks) => Object.freeze(tasks.map((t) => Object.freeze({ ...t })));

describe('taskQuery domain functions', () => {
  describe('filterTasks', () => {
    const tasks = frozen([
      task('a', { status: 'pending', priority: 'low' }),
      task('b', { status: 'in_progress', priority: 'high' }),
      task('c', { status: 'pending', priority: 'high' }),
      task('d', { status: 'completed', priority: null }),
    ]);

    it('returns every task when no filters are given', () => {
      const result = filterTasks(tasks, {});
      expect(ids(result)).toEqual(['a', 'b', 'c', 'd']);
      expect(result).not.toBe(tasks);
    });

    it('applies filters conjunctively', () => {
      expect(ids(filterTasks(tasks, { status: 'pending' }))).toEqual(['a', 'c']);
      expect(ids(filterTasks(tasks, { priority: 'high' }))).toEqual(['b', 'c']);
      expect(ids(filterTasks(tasks, { status: 'pending', priority: 'high' }))).toEqual(['c']);
      expect(filterTasks(tasks, { status: 'completed', priority: 'low' })).toEqual([]);
    });
  });

  describe('sortTasks', () => {
    it('only exposes allowlisted model fields', () => {
      expect(SORTABLE_FIELDS).toEqual([
        'createdAt',
        'updatedAt',
        'completedAt',
        'title',
        'priority',
        'status',
      ]);
    });

    it('throws for fields outside the allowlist, including prototype keys', () => {
      for (const field of ['id', 'description', '__proto__', 'constructor', 'toString']) {
        expect(() => sortTasks([], { sortBy: field })).toThrow(TypeError);
      }
    });

    it('does not mutate the input array (frozen input would throw)', () => {
      const tasks = frozen([task('b', { title: 'B' }), task('a', { title: 'A' })]);
      const result = sortTasks(tasks, { sortBy: 'title' });
      expect(ids(result)).toEqual(['a', 'b']);
      expect(ids(tasks)).toEqual(['b', 'a']);
    });

    it('sorts priority by rank, not alphabetically, with nulls last in both directions', () => {
      const tasks = frozen([
        task('none', { priority: null }),
        task('med', { priority: 'medium' }),
        task('high', { priority: 'high' }),
        task('low', { priority: 'low' }),
      ]);
      expect(ids(sortTasks(tasks, { sortBy: 'priority', order: 'asc' }))).toEqual([
        'low', 'med', 'high', 'none',
      ]);
      expect(ids(sortTasks(tasks, { sortBy: 'priority', order: 'desc' }))).toEqual([
        'high', 'med', 'low', 'none',
      ]);
    });

    it('sorts status in lifecycle order', () => {
      const tasks = frozen([
        task('c', { status: 'completed' }),
        task('p', { status: 'pending' }),
        task('i', { status: 'in_progress' }),
      ]);
      expect(ids(sortTasks(tasks, { sortBy: 'status' }))).toEqual(['p', 'i', 'c']);
      expect(ids(sortTasks(tasks, { sortBy: 'status', order: 'desc' }))).toEqual(['c', 'i', 'p']);
    });

    it('sorts titles case-insensitively with natural number ordering', () => {
      const tasks = frozen([
        task('1', { title: 'task 10' }),
        task('2', { title: 'Task 2' }),
        task('3', { title: 'apple' }),
        task('4', { title: 'Banana' }),
      ]);
      expect(sortTasks(tasks, { sortBy: 'title' }).map((t) => t.title)).toEqual([
        'apple', 'Banana', 'Task 2', 'task 10',
      ]);
    });

    it('breaks ties by createdAt, then insertion order, following the sort direction', () => {
      const tasks = frozen([
        task('late-1', { priority: 'high', createdAt: '2026-01-02T00:00:00.000Z' }),
        task('early-1', { priority: 'high', createdAt: '2026-01-01T00:00:00.000Z' }),
        task('early-2', { priority: 'high', createdAt: '2026-01-01T00:00:00.000Z' }),
      ]);
      expect(ids(sortTasks(tasks, { sortBy: 'priority', order: 'asc' }))).toEqual([
        'early-1', 'early-2', 'late-1',
      ]);
      expect(ids(sortTasks(tasks, { sortBy: 'priority', order: 'desc' }))).toEqual([
        'late-1', 'early-2', 'early-1',
      ]);
    });

    it('orders tasks with null sort values among themselves by the tie-breakers', () => {
      const tasks = frozen([
        task('b', { completedAt: null, createdAt: '2026-01-02T00:00:00.000Z' }),
        task('x', { completedAt: '2026-01-05T00:00:00.000Z' }),
        task('a', { completedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }),
      ]);
      expect(ids(sortTasks(tasks, { sortBy: 'completedAt' }))).toEqual(['x', 'a', 'b']);
      expect(ids(sortTasks(tasks, { sortBy: 'completedAt', order: 'desc' }))).toEqual(['x', 'b', 'a']);
    });
  });

  describe('paginate', () => {
    const items = Object.freeze(Array.from({ length: 7 }, (_, i) => i + 1));

    it.each([
      [{ page: 1, limit: 3 }, [1, 2, 3], 3],
      [{ page: 2, limit: 3 }, [4, 5, 6], 3],
      [{ page: 3, limit: 3 }, [7], 3],
      [{ page: 4, limit: 3 }, [], 3],
      [{ page: 1, limit: 7 }, [1, 2, 3, 4, 5, 6, 7], 1],
      [{ page: 1, limit: 100 }, [1, 2, 3, 4, 5, 6, 7], 1],
    ])('%j', (options, data, totalPages) => {
      expect(paginate(items, options)).toEqual({
        data,
        pagination: { ...options, totalItems: 7, totalPages },
      });
    });

    it('reports zero pages for an empty collection', () => {
      expect(paginate([], { page: 1, limit: 10 })).toEqual({
        data: [],
        pagination: { page: 1, limit: 10, totalItems: 0, totalPages: 0 },
      });
    });
  });
});
