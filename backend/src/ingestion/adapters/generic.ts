import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { TitanCloudEvent, AlertSeveritySchema } from '../../types/cloudevents.js';
import { computeAlertFingerprint } from '../../utils/crypto.js';

export const GenericAlertInputSchema = z.object({
  alertName: z.string().min(1, 'alertName is required'),
  severity: AlertSeveritySchema.default('MEDIUM'),
  status: z.enum(['firing', 'resolved']).default('firing'),
  service: z.string().min(1, 'service is required'),
  environment: z.string().default('production'),
  cluster: z.string().optional(),
  summary: z.string().min(1, 'summary is required'),
  details: z.record(z.unknown()).optional().default({}),
  labels: z.record(z.string()).optional().default({}),
  generatorUrl: z.string().url().optional(),
  tenantId: z.string().uuid().optional().default('00000000-0000-0000-0000-000000000001'),
});

export type GenericAlertInput = z.infer<typeof GenericAlertInputSchema>;

export function parseGenericAlert(payload: unknown, sourceIp: string): TitanCloudEvent[] {
  const parsed = GenericAlertInputSchema.parse(payload);

  const fingerprint = computeAlertFingerprint({
    source: 'generic',
    service: parsed.service,
    environment: parsed.environment,
    alertName: parsed.alertName,
    cluster: parsed.cluster,
  });

  const now = new Date().toISOString();

  const cloudEvent: TitanCloudEvent = {
    specversion: '1.0',
    id: uuidv4(),
    source: `/ingress/generic/${sourceIp}`,
    type: 'titan.telemetry.alert',
    datacontenttype: 'application/json',
    time: now,
    subject: `service/${parsed.service}/${parsed.alertName}`,
    tenantId: parsed.tenantId,
    data: {
      fingerprint,
      alertName: parsed.alertName,
      severity: parsed.severity,
      status: parsed.status,
      service: parsed.service,
      environment: parsed.environment,
      cluster: parsed.cluster,
      summary: parsed.summary,
      details: parsed.details,
      labels: parsed.labels,
      generatorUrl: parsed.generatorUrl,
      startedAt: now,
    },
  };

  return [cloudEvent];
}
