import { randomUUID } from 'node:crypto';
import { NotFoundError } from '../errors/AppError.js';

/**
 * In-memory task store. A factory is used so each app instance (and each
 * test) gets an isolated store.
 */
export function createTaskService() {
  const tasks = new Map();

  return {
    create({ title, description, priority }) {
      const now = new Date().toISOString();
      const task = {
        id: randomUUID(),
        title,
        description: description ?? null,
        priority: priority ?? null,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      tasks.set(task.id, task);
      return { ...task };
    },

    list() {
      return [...tasks.values()].map((task) => ({ ...task }));
    },

    getById(id) {
      const task = tasks.get(id);
      if (!task) throw new NotFoundError(`Task with id '${id}' not found`);
      return { ...task };
    },
  };
}
