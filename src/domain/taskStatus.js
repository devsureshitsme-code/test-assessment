import { ConflictError } from '../errors/AppError.js';

export const TASK_STATUSES = Object.freeze(['pending', 'in_progress', 'completed']);

export const INITIAL_STATUS = 'pending';

/**
 * Single source of truth for the task lifecycle. Each key lists the statuses
 * it may move to; a status with no outgoing transitions is terminal.
 */
export const STATUS_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['in_progress']),
  in_progress: Object.freeze(['completed', 'pending']),
  completed: Object.freeze([]),
});

export function canTransition(from, to) {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status) {
  return STATUS_TRANSITIONS[status]?.length === 0;
}

/**
 * @throws {ConflictError} when `from -> to` is not a permitted transition.
 */
export function assertTransition(from, to) {
  if (canTransition(from, to)) return;

  const message = isTerminal(from)
    ? `Cannot change status of a ${from} task; '${from}' is a terminal status`
    : `Cannot transition task from '${from}' to '${to}'`;

  throw new ConflictError('INVALID_STATUS_TRANSITION', message, {
    currentStatus: from,
    requestedStatus: to,
    allowedTransitions: [...STATUS_TRANSITIONS[from]],
  });
}
