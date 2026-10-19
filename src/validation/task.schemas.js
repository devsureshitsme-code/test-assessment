import { z } from 'zod';

export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 1000;
export const TASK_PRIORITIES = ['low', 'medium', 'high'];

export const createTaskSchema = z
  .object(
    {
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
        .max(
          DESCRIPTION_MAX_LENGTH,
          `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
        )
        .optional(),
      priority: z
        .enum(TASK_PRIORITIES, {
          error: `Priority must be one of: ${TASK_PRIORITIES.join(', ')}`,
        })
        .optional(),
    },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys'
          ? `Unknown field(s): ${issue.keys.join(', ')}`
          : 'Request body must be a JSON object',
    },
  )
  // Reject unknown fields (e.g. `id`, `status`, `createdAt`) so clients cannot
  // set server-controlled properties.
  .strict();

export const taskIdParamsSchema = z.object({
  id: z.uuid({ error: 'Task ID must be a valid UUID' }),
});
