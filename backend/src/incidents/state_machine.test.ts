import { describe, it, expect } from 'vitest';
import { isValidTransition, VALID_TRANSITIONS, IncidentStatus } from '../types/incidents.js';

describe('Incident State Machine Transition Rules', () => {
  it('should permit standard canonical progression', () => {
    expect(isValidTransition('TRIGGERED', 'ACKNOWLEDGED')).toBe(true);
    expect(isValidTransition('ACKNOWLEDGED', 'INVESTIGATING')).toBe(true);
    expect(isValidTransition('INVESTIGATING', 'MITIGATING')).toBe(true);
    expect(isValidTransition('MITIGATING', 'RESOLVED')).toBe(true);
    expect(isValidTransition('RESOLVED', 'CLOSED')).toBe(true);
  });

  it('should permit expedited triage transitions', () => {
    expect(isValidTransition('ACKNOWLEDGED', 'MITIGATING')).toBe(true);
    expect(isValidTransition('ACKNOWLEDGED', 'RESOLVED')).toBe(true);
    expect(isValidTransition('INVESTIGATING', 'RESOLVED')).toBe(true);
  });

  it('should allow reopening a resolved incident if failure recurs', () => {
    expect(isValidTransition('RESOLVED', 'INVESTIGATING')).toBe(true);
  });

  it('should treat transitions to identical state as idempotent (true)', () => {
    const allStatuses: IncidentStatus[] = [
      'TRIGGERED',
      'ACKNOWLEDGED',
      'INVESTIGATING',
      'MITIGATING',
      'RESOLVED',
      'CLOSED',
    ];

    for (const status of allStatuses) {
      expect(isValidTransition(status, status)).toBe(true);
    }
  });

  it('should reject illegal skips and backward transitions', () => {
    // Cannot close directly from Triggered without acknowledging/mitigating
    expect(isValidTransition('TRIGGERED', 'CLOSED')).toBe(false);
    expect(isValidTransition('TRIGGERED', 'MITIGATING')).toBe(false);

    // Cannot transition out of CLOSED (terminal state)
    expect(isValidTransition('CLOSED', 'TRIGGERED')).toBe(false);
    expect(isValidTransition('CLOSED', 'ACKNOWLEDGED')).toBe(false);
    expect(isValidTransition('CLOSED', 'INVESTIGATING')).toBe(false);
    expect(isValidTransition('CLOSED', 'RESOLVED')).toBe(false);

    // Cannot move back to Triggered
    expect(isValidTransition('ACKNOWLEDGED', 'TRIGGERED')).toBe(false);
    expect(isValidTransition('INVESTIGATING', 'TRIGGERED')).toBe(false);
    expect(isValidTransition('MITIGATING', 'TRIGGERED')).toBe(false);
  });

  it('should ensure every status is mapped in transition table', () => {
    const definedStatuses = Object.keys(VALID_TRANSITIONS);
    expect(definedStatuses).toHaveLength(6);
    expect(definedStatuses).toContain('TRIGGERED');
    expect(definedStatuses).toContain('CLOSED');
  });
});
