import crypto from 'node:crypto';

export interface AuditLogRecord {
  id: number | string;
  actor_id: string | null;
  actor_ip: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state: unknown;
  after_state: unknown;
  prev_hash: string;
  row_hash: string;
  created_at: string | Date;
}

export interface VerificationResult {
  isValid: boolean;
  tamperedIndex?: number;
  reason?: string;
}

export function computeRowHash(params: {
  prevHash: string;
  actorId: string | null;
  actorIp: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeState: unknown;
  afterState: unknown;
  createdAt: string | Date;
}): string {
  const serialized = [
    params.prevHash,
    params.actorId || 'SYSTEM',
    params.actorIp,
    params.action,
    params.entityType,
    params.entityId,
    JSON.stringify(params.beforeState ?? null),
    JSON.stringify(params.afterState ?? null),
    new Date(params.createdAt).toISOString(),
  ].join('|');

  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Validates the cryptographic integrity of an audit log chain.
 */
export function verifyAuditChain(logs: AuditLogRecord[]): VerificationResult {
  if (logs.length === 0) {
    return { isValid: true };
  }

  let expectedPrevHash = logs[0]!.prev_hash;

  for (let i = 0; i < logs.length; i++) {
    const entry = logs[i]!;

    // 1. Verify that prev_hash matches previous record's row_hash
    if (entry.prev_hash !== expectedPrevHash) {
      return {
        isValid: false,
        tamperedIndex: i,
        reason: `Broken chain link at index ${i}: prev_hash does not match preceding row_hash`,
      };
    }

    // 2. Recompute row hash from values
    const computedHash = computeRowHash({
      prevHash: entry.prev_hash,
      actorId: entry.actor_id,
      actorIp: entry.actor_ip,
      action: entry.action,
      entityType: entry.entity_type,
      entityId: entry.entity_id,
      beforeState: entry.before_state,
      afterState: entry.after_state,
      createdAt: entry.created_at,
    });

    if (computedHash !== entry.row_hash) {
      return {
        isValid: false,
        tamperedIndex: i,
        reason: `Hash mismatch at index ${i}: stored row_hash does not match recomputed SHA-256 hash (tampering detected)`,
      };
    }

    expectedPrevHash = entry.row_hash;
  }

  return { isValid: true };
}
