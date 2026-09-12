import { z } from 'zod';

/**
 * CloudEvents v1.0 Standard Specification & Telemetry Payload Schema
 * Compliant with CNCF CloudEvents 1.0 specification
 */

export const AlertSeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

export const AlertStatusSchema = z.enum(['firing', 'resolved']);
export type AlertStatus = z.infer<typeof AlertStatusSchema>;

export const TitanAlertDataSchema = z.object({
  fingerprint: z.string().length(64, 'Fingerprint must be a 64-character SHA-256 hash'),
  alertName: z.string().min(1).max(128),
  severity: AlertSeveritySchema,
  status: AlertStatusSchema,
  service: z.string().min(1).max(128),
  environment: z.string().min(1).max(64).default('production'),
  cluster: z.string().max(64).optional(),
  summary: z.string().min(1).max(512),
  details: z.record(z.unknown()).default({}),
  labels: z.record(z.string()).default({}),
  generatorUrl: z.string().url().optional(),
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().optional(),
});

export type TitanAlertData = z.infer<typeof TitanAlertDataSchema>;

export const TitanCloudEventSchema = z.object({
  specversion: z.literal('1.0'),
  id: z.string().uuid(),
  source: z.string().min(1),
  type: z.literal('titan.telemetry.alert'),
  datacontenttype: z.literal('application/json'),
  time: z.string().datetime(),
  subject: z.string().min(1),
  tenantId: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
  data: TitanAlertDataSchema,
});

export type TitanCloudEvent = z.infer<typeof TitanCloudEventSchema>;
