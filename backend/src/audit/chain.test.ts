import { describe, it, expect } from 'vitest';
import { computeRowHash, verifyAuditChain, AuditLogRecord } from './chain.js';

describe('Cryptographic Audit Trail Verification', () => {
  function buildTestChain(): AuditLogRecord[] {
    const genesisPrevHash = '0'.repeat(64);
    const now = new Date('2026-09-12T12:00:00.000Z');

    const row1Hash = computeRowHash({
      prevHash: genesisPrevHash,
      actorId: 'user-admin',
      actorIp: '10.0.0.1',
      action: 'USER_LOGIN',
      entityType: 'USER',
      entityId: 'user-admin',
      beforeState: null,
      afterState: { session: 'active' },
      createdAt: now,
    });

    const row1: AuditLogRecord = {
      id: 1,
      actor_id: 'user-admin',
      actor_ip: '10.0.0.1',
      action: 'USER_LOGIN',
      entity_type: 'USER',
      entity_id: 'user-admin',
      before_state: null,
      after_state: { session: 'active' },
      prev_hash: genesisPrevHash,
      row_hash: row1Hash,
      created_at: now,
    };

    const row2Time = new Date('2026-09-12T12:05:00.000Z');
    const row2Hash = computeRowHash({
      prevHash: row1Hash,
      actorId: 'user-admin',
      actorIp: '10.0.0.1',
      action: 'UPDATE_SLA_POLICY',
      entityType: 'POLICY',
      entityId: 'policy-p1',
      beforeState: { timeout: 30 },
      afterState: { timeout: 15 },
      createdAt: row2Time,
    });

    const row2: AuditLogRecord = {
      id: 2,
      actor_id: 'user-admin',
      actor_ip: '10.0.0.1',
      action: 'UPDATE_SLA_POLICY',
      entity_type: 'POLICY',
      entity_id: 'policy-p1',
      before_state: { timeout: 30 },
      after_state: { timeout: 15 },
      prev_hash: row1Hash,
      row_hash: row2Hash,
      created_at: row2Time,
    };

    return [row1, row2];
  }

  it('should verify integrity of an untampered audit chain', () => {
    const chain = buildTestChain();
    const result = verifyAuditChain(chain);

    expect(result.isValid).toBe(true);
  });

  it('should detect when audit row content is tampered with', () => {
    const chain = buildTestChain();
    // Tamper with action
    chain[1]!.action = 'UNAUTHORIZED_MUTATION';

    const result = verifyAuditChain(chain);
    expect(result.isValid).toBe(false);
    expect(result.tamperedIndex).toBe(1);
    expect(result.reason).toContain('tampering detected');
  });

  it('should detect when prev_hash linkage is broken', () => {
    const chain = buildTestChain();
    // Break cryptographic linkage
    chain[1]!.prev_hash = 'f'.repeat(64);

    const result = verifyAuditChain(chain);
    expect(result.isValid).toBe(false);
    expect(result.tamperedIndex).toBe(1);
    expect(result.reason).toContain('Broken chain link');
  });
});
