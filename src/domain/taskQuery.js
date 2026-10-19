import { TASK_STATUSES } from './taskStatus.js';

export const TASK_PRIORITIES = Object.freeze(['low', 'medium', 'high']);

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;
export const DEFAULT_SORT_BY = 'createdAt';
export const DEFAULT_ORDER = 'asc';
export const SORT_ORDERS = Object.freeze(['asc', 'desc']);

const rankOf = (values) => (value) => values.indexOf(value);
const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareNumbers = (a, b) => a - b;

/**
 * Allowlist of sortable fields. Each entry maps a task to a comparable value
 * and says how to compare two such values. Enum-like fields sort by their
 * meaning (low < medium < high, lifecycle order for status) rather than
 * alphabetically. Fields not listed here cannot be sorted on.
 */
const SORTERS = Object.freeze({
  createdAt: { key: (t) => t.createdAt, compare: compareStrings }, // ISO 8601 sorts lexically
  updatedAt: { key: (t) => t.updatedAt, compare: compareStrings },
  completedAt: { key: (t) => t.completedAt, compare: compareStrings },
  title: {
    key: (t) => t.title,
    compare: (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true }),
  },
  priority: { key: (t) => t.priority && rankOf(TASK_PRIORITIES)(t.priority), compare: compareNumbers },
  status: { key: (t) => rankOf(TASK_STATUSES)(t.status), compare: compareNumbers },
});

export const SORTABLE_FIELDS = Object.freeze(Object.keys(SORTERS));

/** Returns a new array containing tasks that match every provided filter. */
export function filterTasks(tasks, { status, priority } = {}) {
  return tasks.filter(
    (task) =>
      (status === undefined || task.status === status) &&
      (priority === undefined || task.priority === priority),
  );
}

/**
 * Returns a new, sorted array. Ordering is fully deterministic:
 *   1. the requested field, with null values always last;
 *   2. ties broken by createdAt, then by original (insertion) position,
 *      both following the requested direction.
 */
export function sortTasks(tasks, { sortBy = DEFAULT_SORT_BY, order = DEFAULT_ORDER } = {}) {
  // hasOwn guards against inherited keys such as 'constructor' or 'toString'.
  if (!Object.hasOwn(SORTERS, sortBy)) throw new TypeError(`Unsupported sort field: ${sortBy}`);
  const sorter = SORTERS[sortBy];
  const direction = order === 'desc' ? -1 : 1;

  return tasks
    .map((task, index) => ({ task, index, value: sorter.key(task) }))
    .sort((a, b) => {
      const aMissing = a.value == null;
      const bMissing = b.value == null;
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      if (!aMissing) {
        const primary = sorter.compare(a.value, b.value);
        if (primary !== 0) return primary * direction;
      }
      return (
        (compareStrings(a.task.createdAt, b.task.createdAt) || a.index - b.index) * direction
      );
    })
    .map(({ task }) => task);
}

/** Returns one page of `items` plus pagination metadata. */
export function paginate(items, { page = DEFAULT_PAGE, limit = DEFAULT_LIMIT } = {}) {
  const totalItems = items.length;
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
  };
}
