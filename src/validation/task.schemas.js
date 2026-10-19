import { z } from 'zod';
import { TASK_STATUSES } from '../domain/taskStatus.js';

export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 1000;
export const TASK_PRIORITIES = ['low', 'medium', 'high'];

const taskFields = {
  title: z
    .string({
      error: (issue) =>
        issue.input === undefined ? 'Title is required' : 'Title must be a string',
    })
    .trim()
    .min(1, 'Title must not be empty')
    .max(TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`),
  description: z
    .string({ error: 'Description must be a string' })
    .trim()
    .max(DESCRIPTION_MAX_LENGTH, `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`),
  priority: z.enum(TASK_PRIORITIES, {
    error: `Priority must be one of: ${TASK_PRIORITIES.join(', ')}`,
  }),
};

function unknownKeysMessage(keys) {
  const message = `Unknown field(s): ${keys.join(', ')}`;
  return keys.includes('status')
    ? `${message}. Use PATCH /api/tasks/:id/status to change a task's status`
    : message;
}

/**
 * JSON-object body schema that rejects unknown fields, so clients cannot set
 * server-controlled properties (id, status, timestamps).
 */
function strictBody(shape) {
  return z
    .object(shape, {
      error: (issue) =>
        issue.code === 'unrecognized_keys'
          ? unknownKeysMessage(issue.keys)
          : 'Request body must be a JSON object',
    })
    .strict();
}

export const createTaskSchema = strictBody({
  title: taskFields.title,
  description: taskFields.description.optional(),
  priority: taskFields.priority.optional(),
});

export const updateTaskSchema = strictBody({
  title: taskFields.title.optional(),
  description: taskFields.description.optional(),
  priority: taskFields.priority.optional(),
}).refine((body) => Object.values(body).some((value) => value !== undefined), {
  error: 'At least one of title, description or priority must be provided',
});

export const updateTaskStatusSchema = strictBody({
  status: z.enum(TASK_STATUSES, {
    error: (issue) =>
      issue.input === undefined
        ? 'Status is required'
        : `Status must be one of: ${TASK_STATUSES.join(', ')}`,
  }),
});

export const taskIdParamsSchema = z.object({
  id: z.uuid({ error: 'Task ID must be a valid UUID' }),
});
