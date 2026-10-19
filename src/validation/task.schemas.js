import { z } from 'zod';
import {
  DEFAULT_LIMIT,
  DEFAULT_ORDER,
  DEFAULT_PAGE,
  DEFAULT_SORT_BY,
  MAX_LIMIT,
  SORTABLE_FIELDS,
  SORT_ORDERS,
  TASK_PRIORITIES,
} from '../domain/taskQuery.js';
import { TASK_STATUSES } from '../domain/taskStatus.js';

export { TASK_PRIORITIES };
export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 1000;

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

/**
 * A single query-string value. Express parses repeated keys (`?a=1&a=2`) into
 * arrays; those are rejected rather than silently picking one value.
 */
function singleQueryValue(name) {
  return z.string({
    error: (issue) =>
      Array.isArray(issue.input) ? `${name} must be provided only once` : `${name} must be a string`,
  });
}

function enumQueryParam(name, values) {
  return singleQueryValue(name).pipe(
    z.enum(values, { error: `${name} must be one of: ${values.join(', ')}` }),
  );
}

/**
 * Positive integer written as plain digits. A regex is used instead of
 * z.coerce.number() because Number() accepts '', ' 1', '1e1', '0x10' and '1.0'.
 */
function positiveIntQueryParam(name, { max } = {}) {
  const message = `${name} must be a positive integer`;
  let schema = singleQueryValue(name)
    .regex(/^[1-9][0-9]*$/, message)
    .transform(Number)
    .pipe(z.number().max(Number.MAX_SAFE_INTEGER, `${name} is too large`));
  if (max !== undefined) {
    schema = schema.pipe(z.number().max(max, `${name} must not exceed ${max}`));
  }
  return schema;
}

export const listTasksQuerySchema = z
  .object(
    {
      status: enumQueryParam('status', TASK_STATUSES).optional(),
      priority: enumQueryParam('priority', TASK_PRIORITIES).optional(),
      page: positiveIntQueryParam('page').default(DEFAULT_PAGE),
      limit: positiveIntQueryParam('limit', { max: MAX_LIMIT }).default(DEFAULT_LIMIT),
      sortBy: enumQueryParam('sortBy', SORTABLE_FIELDS).default(DEFAULT_SORT_BY),
      order: enumQueryParam('order', SORT_ORDERS).default(DEFAULT_ORDER),
    },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys'
          ? `Unknown query parameter(s): ${issue.keys.join(', ')}`
          : 'Invalid query string',
    },
  )
  .strict();
