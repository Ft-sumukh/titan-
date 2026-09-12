import { z } from 'zod';

/**
 * Incident State Machine & Domain Models
 */

export const IncidentStatusEnum = z.enum([
  'TRIGGERED',
  'ACKNOWLEDGED',
  'INVESTIGATING',
  'MITIGATING',
  'RESOLVED',
  'CLOSED',
]);
export type IncidentStatus = z.infer<typeof IncidentStatusEnum>;

export const IncidentPriorityEnum = z.enum(['P1', 'P2', 'P3', 'P4']);
export type IncidentPriority = z.infer<typeof IncidentPriorityEnum>;

export const UserRoleEnum = z.enum([
  'ADMIN',
  'INCIDENT_COMMANDER',
  'RESPONDER',
  'OBSERVER',
]);
export type UserRole = z.infer<typeof UserRoleEnum>;

/**
 * Legal transition state graph
 */
export const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  TRIGGERED: ['ACKNOWLEDGED', 'INVESTIGATING'],
  ACKNOWLEDGED: ['INVESTIGATING', 'MITIGATING', 'RESOLVED'],
  INVESTIGATING: ['MITIGATING', 'RESOLVED'],
  MITIGATING: ['INVESTIGATING', 'RESOLVED'],
  RESOLVED: ['CLOSED', 'INVESTIGATING'], // Can reopen if alert re-fires
  CLOSED: [], // Terminal state
};

export function isValidTransition(currentStatus: IncidentStatus, newStatus: IncidentStatus): boolean {
  if (currentStatus === newStatus) return true; // Idempotent
  const allowed = VALID_TRANSITIONS[currentStatus] || [];
  return allowed.includes(newStatus);
}

export interface IncidentRecord {
  id: string;
  tenant_id: string;
  incident_number: number;
  title: string;
  summary: string | null;
  status: IncidentStatus;
  priority: IncidentPriority;
  commander_id: string | null;
  lead_responder_id: string | null;
  service_name: string;
  environment: string;
  alert_count: number;
  version: number;
  triggered_at: Date;
  acknowledged_at: Date | null;
  mitigated_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
