import { randomUUID } from 'node:crypto';
import { INITIAL_STATUS, assertTransition } from '../domain/taskStatus.js';
import { NotFoundError } from '../errors/AppError.js';

/**
 * In-memory task store. A factory is used so each app instance (and each
 * test) gets an isolated store.
 *
 * Mutations build a complete replacement object and only write it to the
 * store once every check has passed, so a failed update never leaves a task
 * partially modified.
 *
 * @param {{ now?: () => Date }} [options] `now` is injectable for deterministic tests.
 */
export function createTaskService({ now = () => new Date() } = {}) {
  const tasks = new Map();

  function findOrThrow(id) {
    const task = tasks.get(id);
    if (!task) throw new NotFoundError(`Task with id '${id}' not found`);
    return task;
  }

  function save(task) {
    tasks.set(task.id, task);
    return { ...task };
  }

  return {
    create({ title, description, priority }) {
      const timestamp = now().toISOString();
      return save({
        id: randomUUID(),
        title,
        description: description ?? null,
        priority: priority ?? null,
        status: INITIAL_STATUS,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      });
    },

    list() {
      return [...tasks.values()].map((task) => ({ ...task }));
    },

    getById(id) {
      return { ...findOrThrow(id) };
    },

    /**
     * Updates editable details. Lifecycle fields (status, completedAt) are
     * deliberately not accepted here; use `updateStatus` for those.
     */
    update(id, { title, description, priority }) {
      const current = findOrThrow(id);
      const changes = Object.fromEntries(
        Object.entries({ title, description, priority }).filter(([, v]) => v !== undefined),
      );
      return save({ ...current, ...changes, updatedAt: now().toISOString() });
    },

    updateStatus(id, status) {
      const current = findOrThrow(id);
      assertTransition(current.status, status);

      const timestamp = now().toISOString();
      return save({
        ...current,
        status,
        updatedAt: timestamp,
        // Only entering `completed` sets the timestamp. Because `completed` is
        // terminal, an existing completedAt can never be overwritten.
        completedAt: status === 'completed' ? timestamp : current.completedAt,
      });
    },
  };
}
