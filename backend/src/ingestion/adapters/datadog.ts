import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { TitanCloudEvent, AlertSeverity } from '../../types/cloudevents.js';
import { computeAlertFingerprint } from '../../utils/crypto.js';

export const DatadogWebhookSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  title: z.string().min(1, 'title is required'),
  body: z.string().default(''),
  event_type: z.string().optional().default('metric_alert_event'),
  alert_type: z.enum(['error', 'warning', 'info', 'success']).default('error'),
  date: z.union([z.number(), z.string()]).optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional().default([]),
  link: z.string().url().optional(),
  tenantId: z.string().uuid().optional().default('00000000-0000-0000-0000-000000000001'),
});

export type DatadogWebhookPayload = z.infer<typeof DatadogWebhookSchema>;

function normalizeDatadogSeverity(alertType: string): AlertSeverity {
  if (alertType === 'error') return 'CRITICAL';
  if (alertType === 'warning') return 'HIGH';
  if (alertType === 'info') return 'INFO';
  return 'MEDIUM';
}

function parseTags(rawTags: string | string[]): Record<string, string> {
  const tagsList = Array.isArray(rawTags) ? rawTags : rawTags.split(',').map((t) => t.trim());
  const tagRecord: Record<string, string> = {};

  for (const tag of tagsList) {
    const [key, ...rest] = tag.split(':');
    if (key && rest.length > 0) {
      tagRecord[key.trim()] = rest.join(':').trim();
    } else if (key) {
      tagRecord[key.trim()] = 'true';
    }
  }

  return tagRecord;
}

export function parseDatadogAlert(payload: unknown, sourceIdentifier: string): TitanCloudEvent[] {
  const parsed = DatadogWebhookSchema.parse(payload);
  const now = new Date().toISOString();

  const labels = parseTags(parsed.tags);
  const alertName = parsed.title;
  const service = labels['service'] || 'unknown-service';
  const environment = labels['env'] || labels['environment'] || 'production';
  const cluster = labels['cluster'] || 'default';
  const severity = normalizeDatadogSeverity(parsed.alert_type);
  const status = parsed.alert_type === 'success' ? 'resolved' : 'firing';

  const fingerprint = computeAlertFingerprint({
    source: 'datadog',
    service,
    environment,
    alertName,
    cluster,
  });

  const cloudEvent: TitanCloudEvent = {
    specversion: '1.0',
    id: uuidv4(),
    source: `/monitoring/datadog/${sourceIdentifier}`,
    type: 'titan.telemetry.alert',
    datacontenttype: 'application/json',
    time: now,
    subject: `service/${service}/${alertName}`,
    tenantId: parsed.tenantId,
    data: {
      fingerprint,
      alertName,
      severity,
      status,
      service,
      environment,
      cluster,
      summary: parsed.title,
      details: {
        body: parsed.body,
        datadogId: parsed.id,
      },
      labels,
      generatorUrl: parsed.link,
      startedAt: now,
    },
  };

  return [cloudEvent];
}
