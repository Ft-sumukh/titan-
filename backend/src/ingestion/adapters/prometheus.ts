import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { TitanCloudEvent, AlertSeverity } from '../../types/cloudevents.js';
import { computeAlertFingerprint } from '../../utils/crypto.js';

export const PrometheusAlertSchema = z.object({
  status: z.enum(['firing', 'resolved']).default('firing'),
  labels: z.record(z.string()),
  annotations: z.record(z.string()).optional().default({}),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  generatorURL: z.string().url().optional(),
});

export const PrometheusWebhookSchema = z.object({
  receiver: z.string().optional(),
  status: z.enum(['firing', 'resolved']).default('firing'),
  alerts: z.array(PrometheusAlertSchema).min(1, 'Payload must contain at least one alert'),
  groupLabels: z.record(z.string()).optional().default({}),
  commonLabels: z.record(z.string()).optional().default({}),
  commonAnnotations: z.record(z.string()).optional().default({}),
  externalURL: z.string().optional(),
  tenantId: z.string().uuid().optional().default('00000000-0000-0000-0000-000000000001'),
});

export type PrometheusWebhookPayload = z.infer<typeof PrometheusWebhookSchema>;

function normalizePrometheusSeverity(rawSeverity?: string): AlertSeverity {
  const s = (rawSeverity || '').toLowerCase();
  if (s === 'critical' || s === 'crit' || s === 'fatal' || s === 'page') return 'CRITICAL';
  if (s === 'warning' || s === 'warn' || s === 'high') return 'HIGH';
  if (s === 'medium' || s === 'med') return 'MEDIUM';
  if (s === 'info' || s === 'informational') return 'INFO';
  return 'MEDIUM';
}

export function parsePrometheusAlerts(payload: unknown, sourceIdentifier: string): TitanCloudEvent[] {
  const parsed = PrometheusWebhookSchema.parse(payload);
  const now = new Date().toISOString();

  return parsed.alerts.map((alert) => {
    const alertName = alert.labels['alertname'] || 'UnknownPrometheusAlert';
    const service = alert.labels['service'] || alert.labels['app'] || alert.labels['job'] || 'unknown-service';
    const environment = alert.labels['env'] || alert.labels['environment'] || 'production';
    const cluster = alert.labels['cluster'] || alert.labels['k8s_cluster'] || 'default';
    const rawSeverity = alert.labels['severity'];
    const severity = normalizePrometheusSeverity(rawSeverity);
    const summary = alert.annotations['summary'] || alert.annotations['description'] || `${alertName} triggered on ${service}`;

    const fingerprint = computeAlertFingerprint({
      source: 'prometheus',
      service,
      environment,
      alertName,
      cluster,
    });

    return {
      specversion: '1.0',
      id: uuidv4(),
      source: `/monitoring/prometheus/${sourceIdentifier}`,
      type: 'titan.telemetry.alert',
      datacontenttype: 'application/json',
      time: now,
      subject: `service/${service}/${alertName}`,
      tenantId: parsed.tenantId,
      data: {
        fingerprint,
        alertName,
        severity,
        status: alert.status,
        service,
        environment,
        cluster,
        summary,
        details: {
          annotations: alert.annotations,
          externalURL: parsed.externalURL,
        },
        labels: alert.labels,
        generatorUrl: alert.generatorURL,
        startedAt: alert.startsAt || now,
        endedAt: alert.endsAt,
      },
    };
  });
}
