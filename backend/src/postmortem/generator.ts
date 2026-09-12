import { IncidentRecord } from '../types/incidents.js';

export interface PostmortemData {
  incident: IncidentRecord;
  timeline: Array<{ event_type: string; content: string; created_at: string | Date }>;
  alerts: Array<{ alert_name: string; severity: string; service: string; received_at: string | Date }>;
}

export interface ResilienceMetrics {
  mttaMinutes: number | null;
  mttmMinutes: number | null;
  totalDurationMinutes: number | null;
}

export function calculateMetrics(incident: IncidentRecord): ResilienceMetrics {
  const triggered = new Date(incident.triggered_at).getTime();
  const acknowledged = incident.acknowledged_at ? new Date(incident.acknowledged_at).getTime() : null;
  const mitigated = incident.mitigated_at ? new Date(incident.mitigated_at).getTime() : null;
  const resolved = incident.resolved_at ? new Date(incident.resolved_at).getTime() : null;

  const mttaMinutes = acknowledged ? Math.round(((acknowledged - triggered) / 60000) * 10) / 10 : null;
  const mttmMinutes = mitigated && acknowledged ? Math.round(((mitigated - acknowledged) / 60000) * 10) / 10 : null;
  const totalDurationMinutes = resolved ? Math.round(((resolved - triggered) / 60000) * 10) / 10 : null;

  return {
    mttaMinutes,
    mttmMinutes,
    totalDurationMinutes,
  };
}

export function generatePostmortemMarkdown(data: PostmortemData): string {
  const { incident, timeline, alerts } = data;
  const metrics = calculateMetrics(incident);

  const lines: string[] = [];

  lines.push(`# Incident Postmortem: INC-${incident.incident_number} — ${incident.title}`);
  lines.push(`**Status:** ${incident.status} | **Priority:** ${incident.priority} | **Service:** ${incident.service_name} (${incident.environment})`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Executive Summary');
  lines.push(incident.summary || 'No executive summary provided.');
  lines.push('');
  lines.push('## 2. Key Resilience Metrics');
  lines.push('| Metric | Value | Target |');
  lines.push('| :--- | :--- | :--- |');
  lines.push(`| **Time to Acknowledge (MTTA)** | ${metrics.mttaMinutes !== null ? `${metrics.mttaMinutes} min` : 'N/A'} | < 2 min |`);
  lines.push(`| **Time to Mitigate (MTTR)** | ${metrics.mttmMinutes !== null ? `${metrics.mttmMinutes} min` : 'N/A'} | < 18 min |`);
  lines.push(`| **Total Incident Duration** | ${metrics.totalDurationMinutes !== null ? `${metrics.totalDurationMinutes} min` : 'N/A'} | < 30 min |`);
  lines.push(`| **Total Correlated Alerts** | ${incident.alert_count} | Noise Reduction >= 75% |`);
  lines.push('');
  lines.push('## 3. Incident Timeline');
  if (timeline.length === 0) {
    lines.push('_No timeline events recorded._');
  } else {
    for (const event of timeline) {
      const timeStr = new Date(event.created_at).toISOString();
      lines.push(`- **\`${timeStr}\`** [${event.event_type}]: ${event.content}`);
    }
  }
  lines.push('');
  lines.push('## 4. Triggering Alerts');
  if (alerts.length === 0) {
    lines.push('_No linked alerts recorded._');
  } else {
    lines.push('| Timestamp | Severity | Alert Name | Service |');
    lines.push('| :--- | :--- | :--- | :--- |');
    for (const a of alerts) {
      lines.push(`| ${new Date(a.received_at).toISOString()} | \`${a.severity}\` | ${a.alert_name} | ${a.service} |`);
    }
  }
  lines.push('');
  lines.push('## 5. Preventative Action Items');
  lines.push('- [ ] Investigate root cause and update architecture documentation.');
  lines.push('- [ ] Implement automated regression test for identified failure mode.');
  lines.push('- [ ] Tune alert thresholds to reduce upstream detection delay.');

  return lines.join('\n');
}
