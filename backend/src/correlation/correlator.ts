import { TitanCloudEvent, AlertSeverity } from '../types/cloudevents.js';
import { IncidentPriority, IncidentRecord } from '../types/incidents.js';
import { IncidentRepository } from '../incidents/repository.js';
import { AlertDeduplicator } from './deduplicator.js';
import { logger } from '../utils/logger.js';

export function calculateIncidentPriority(severity: AlertSeverity): IncidentPriority {
  switch (severity) {
    case 'CRITICAL':
      return 'P1';
    case 'HIGH':
      return 'P2';
    case 'MEDIUM':
      return 'P3';
    case 'LOW':
    case 'INFO':
    default:
      return 'P4';
  }
}

export interface CorrelationOutcome {
  action: 'CREATED_INCIDENT' | 'CORRELATED_TO_EXISTING' | 'DEDUPLICATED';
  incidentId: string;
  alertId: string;
}

export class AlertCorrelator {
  private repo: IncidentRepository;
  private dedupe: AlertDeduplicator;

  constructor(repo?: IncidentRepository, dedupe?: AlertDeduplicator) {
    this.repo = repo || new IncidentRepository();
    this.dedupe = dedupe || new AlertDeduplicator();
  }

  /**
   * Process an incoming CloudEvent through the deduplication & correlation pipeline.
   */
  async processEvent(event: TitanCloudEvent): Promise<CorrelationOutcome> {
    const { fingerprint, service, environment, alertName, severity, summary } = event.data;

    // 1. Save alert record
    const alertId = await this.repo.saveAlert(event);

    // 2. Check Sliding-Window Deduplication
    const dedupeCheck = await this.dedupe.checkDuplicate(fingerprint);
    if (dedupeCheck.isDuplicate && dedupeCheck.associatedIncidentId) {
      await this.repo.linkAlertToIncident(dedupeCheck.associatedIncidentId, alertId, 1.0);
      logger.info(
        { alertId, incidentId: dedupeCheck.associatedIncidentId, fingerprint },
        'Suppressed duplicate alert and linked to existing incident'
      );
      return {
        action: 'DEDUPLICATED',
        incidentId: dedupeCheck.associatedIncidentId,
        alertId,
      };
    }

    // 3. Check for Active Open Incident on the same service & environment
    const activeIncident = await this.repo.findActiveIncidentForService(
      event.tenantId,
      service,
      environment
    );

    if (activeIncident) {
      await this.repo.linkAlertToIncident(activeIncident.id, alertId, 0.9);
      await this.dedupe.recordAlert(fingerprint, activeIncident.id);
      logger.info(
        { alertId, incidentId: activeIncident.id, service, environment },
        'Correlated alert to active open incident'
      );
      return {
        action: 'CORRELATED_TO_EXISTING',
        incidentId: activeIncident.id,
        alertId,
      };
    }

    // 4. Create New Canonical Incident
    const priority = calculateIncidentPriority(severity);
    const title = `[${priority}] ${alertName} on ${service} (${environment})`;

    const newIncident: IncidentRecord = await this.repo.createIncident({
      tenantId: event.tenantId,
      title,
      summary,
      priority,
      serviceName: service,
      environment,
    });

    await this.repo.linkAlertToIncident(newIncident.id, alertId, 1.0);
    await this.dedupe.recordAlert(fingerprint, newIncident.id);

    logger.info(
      { incidentId: newIncident.id, alertId, priority, title },
      'Triggered new canonical incident from alert'
    );

    return {
      action: 'CREATED_INCIDENT',
      incidentId: newIncident.id,
      alertId,
    };
  }
}
