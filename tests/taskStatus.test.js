import { describe, expect, it } from 'vitest';
import {
  STATUS_TRANSITIONS,
  TASK_STATUSES,
  assertTransition,
  canTransition,
  isTerminal,
} from '../src/domain/taskStatus.js';
import { ConflictError } from '../src/errors/AppError.js';

const PERMITTED = [
  ['pending', 'in_progress'],
  ['in_progress', 'completed'],
  ['in_progress', 'pending'],
];

const ALL_PAIRS = TASK_STATUSES.flatMap((from) => TASK_STATUSES.map((to) => [from, to]));
const PROHIBITED = ALL_PAIRS.filter(
  ([from, to]) => !PERMITTED.some(([f, t]) => f === from && t === to),
);

describe('task status domain rules', () => {
  it('covers every status in the transition table', () => {
    expect(Object.keys(STATUS_TRANSITIONS).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('enumerates exactly 6 prohibited transitions', () => {
    expect(PROHIBITED).toHaveLength(6);
  });

  it.each(PERMITTED)('permits %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(PROHIBITED)('prohibits %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(ConflictError);
  });

  it('treats only completed as terminal', () => {
    expect(TASK_STATUSES.filter(isTerminal)).toEqual(['completed']);
  });

  it('rejects statuses outside the lifecycle', () => {
    expect(canTransition('pending', 'archived')).toBe(false);
    expect(canTransition('archived', 'pending')).toBe(false);
  });

  it('describes the conflict in the thrown error', () => {
    try {
      assertTransition('pending', 'completed');
      expect.unreachable();
    } catch (err) {
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('INVALID_STATUS_TRANSITION');
      expect(err.message).toBe("Cannot transition task from 'pending' to 'completed'");
      expect(err.details).toEqual({
        currentStatus: 'pending',
        requestedStatus: 'completed',
        allowedTransitions: ['in_progress'],
      });
    }
  });

  it('cannot be mutated at runtime', () => {
    expect(() => STATUS_TRANSITIONS.completed.push('pending')).toThrow(TypeError);
    expect(canTransition('completed', 'pending')).toBe(false);
  });
});
