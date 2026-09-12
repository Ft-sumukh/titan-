import { describe, it, expect } from 'vitest';
import { generatePostmortemMarkdown, calculateMetrics, PostmortemData } from './generator.js';

describe('Automated Postmortem Generator', () => {
  const triggeredAt = new Date('2026-09-12T14:00:00.000Z');
  const acknowledgedAt = new Date('2026-09-12T14:02:00.000Z'); // 2 min MTTA
  const mitigatedAt = new Date('2026-09-12T14:14:00.000Z'); // 12 min MTTR
  const resolvedAt = new Date('2026-09-12T14:20:00.000Z'); // 20 min total

  const sampleData: PostmortemData = {
    incident: {
      id: '00000000-0000-0000-0000-000000000010',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      incident_number: 1042,
      title: 'Database Connection Pool Exhaustion',
      summary: 'High transaction volume caused payment database pool saturation.',
      status: 'RESOLVED',
      priority: 'P1',
      commander_id: '00000000-0000-0000-0000-000000000005',
      lead_responder_id: '00000000-0000-0000-0000-000000000002',
      service_name: 'payments-service',
      environment: 'production',
      alert_count: 38,
      version: 5,
      triggered_at: triggeredAt,
      acknowledged_at: acknowledgedAt,
      mitigated_at: mitigatedAt,
      resolved_at: resolvedAt,
      closed_at: null,
      created_at: triggeredAt,
      updated_at: resolvedAt,
    },
    timeline: [
      {
        event_type: 'STATUS_CHANGE',
        content: 'Status changed from TRIGGERED to ACKNOWLEDGED',
        created_at: acknowledgedAt,
      },
      {
        event_type: 'RUNBOOK_EXECUTION',
        content: 'Runbook drain-and-scale-db-pool executed successfully',
        created_at: mitigatedAt,
      },
    ],
    alerts: [
      {
        alert_name: 'PostgresConnectionsCritical',
        severity: 'CRITICAL',
        service: 'payments-service',
        received_at: triggeredAt,
      },
    ],
  };

  it('should accurately calculate resilience metrics', () => {
    const metrics = calculateMetrics(sampleData.incident);

    expect(metrics.mttaMinutes).toBe(2);
    expect(metrics.mttmMinutes).toBe(12);
    expect(metrics.totalDurationMinutes).toBe(20);
  });

  it('should compile structured markdown report with all required sections', () => {
    const markdown = generatePostmortemMarkdown(sampleData);

    expect(markdown).toContain('# Incident Postmortem: INC-1042');
    expect(markdown).toContain('Database Connection Pool Exhaustion');
    expect(markdown).toContain('## 1. Executive Summary');
    expect(markdown).toContain('## 2. Key Resilience Metrics');
    expect(markdown).toContain('## 3. Incident Timeline');
    expect(markdown).toContain('## 4. Triggering Alerts');
    expect(markdown).toContain('## 5. Preventative Action Items');
    expect(markdown).toContain('2 min');
    expect(markdown).toContain('12 min');
    expect(markdown).toContain('payments-service');
  });
});
