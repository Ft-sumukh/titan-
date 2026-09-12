import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertCorrelator, calculateIncidentPriority } from './correlator.js';
import { IncidentRepository } from '../incidents/repository.js';
import { AlertDeduplicator } from './deduplicator.js';
import { TitanCloudEvent } from '../types/cloudevents.js';

describe('Alert Correlator & Priority Engine', () => {
  let mockRepo: IncidentRepository;
  let mockDedupe: AlertDeduplicator;
  let correlator: AlertCorrelator;

  beforeEach(() => {
    mockRepo = {
      saveAlert: vi.fn().mockResolvedValue('alert-101'),
      findActiveIncidentForService: vi.fn().mockResolvedValue(null),
      createIncident: vi.fn().mockResolvedValue({
        id: 'inc-999',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        incident_number: 1,
        title: '[P1] HighDatabaseConnections on payments (production)',
        summary: 'Pool saturated',
        status: 'TRIGGERED',
        priority: 'P1',
        service_name: 'payments',
        environment: 'production',
        alert_count: 1,
        version: 1,
        triggered_at: new Date(),
      }),
      linkAlertToIncident: vi.fn().mockResolvedValue(undefined),
      transitionStatus: vi.fn(),
      getIncidentById: vi.fn(),
    } as unknown as IncidentRepository;

    mockDedupe = {
      checkDuplicate: vi.fn().mockResolvedValue({ isDuplicate: false }),
      recordAlert: vi.fn().mockResolvedValue(undefined),
    } as unknown as AlertDeduplicator;

    correlator = new AlertCorrelator(mockRepo, mockDedupe);
  });

  const sampleEvent: TitanCloudEvent = {
    specversion: '1.0',
    id: 'e39c4a88-251f-44aa-9d50-fb6a8b139265',
    source: '/monitoring/prometheus/cluster-01',
    type: 'titan.telemetry.alert',
    datacontenttype: 'application/json',
    time: new Date().toISOString(),
    subject: 'service/payments/HighDatabaseConnections',
    tenantId: '00000000-0000-0000-0000-000000000001',
    data: {
      fingerprint: 'a'.repeat(64),
      alertName: 'HighDatabaseConnections',
      severity: 'CRITICAL',
      status: 'firing',
      service: 'payments',
      environment: 'production',
      summary: 'Pool saturated',
      details: {},
      labels: {},
      startedAt: new Date().toISOString(),
    },
  };

  describe('Priority Calculation', () => {
    it('should map CRITICAL to P1', () => {
      expect(calculateIncidentPriority('CRITICAL')).toBe('P1');
    });

    it('should map HIGH to P2', () => {
      expect(calculateIncidentPriority('HIGH')).toBe('P2');
    });

    it('should map MEDIUM to P3', () => {
      expect(calculateIncidentPriority('MEDIUM')).toBe('P3');
    });

    it('should map LOW and INFO to P4', () => {
      expect(calculateIncidentPriority('LOW')).toBe('P4');
      expect(calculateIncidentPriority('INFO')).toBe('P4');
    });
  });

  describe('Correlation Workflow', () => {
    it('should create a new canonical incident when no active incident exists', async () => {
      const outcome = await correlator.processEvent(sampleEvent);

      expect(outcome.action).toBe('CREATED_INCIDENT');
      expect(outcome.incidentId).toBe('inc-999');
      expect(outcome.alertId).toBe('alert-101');
      expect(mockRepo.createIncident).toHaveBeenCalledOnce();
      expect(mockRepo.linkAlertToIncident).toHaveBeenCalledWith('inc-999', 'alert-101', 1.0);
      expect(mockDedupe.recordAlert).toHaveBeenCalledWith(sampleEvent.data.fingerprint, 'inc-999');
    });

    it('should link to an existing open incident on the same service', async () => {
      vi.mocked(mockRepo.findActiveIncidentForService).mockResolvedValue({
        id: 'inc-existing-123',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        incident_number: 42,
        title: 'Existing Incident',
        summary: null,
        status: 'INVESTIGATING',
        priority: 'P2',
        service_name: 'payments',
        environment: 'production',
        alert_count: 3,
        version: 2,
        triggered_at: new Date(),
        acknowledged_at: new Date(),
        mitigated_at: null,
        resolved_at: null,
        closed_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        commander_id: null,
        lead_responder_id: null,
      });

      const outcome = await correlator.processEvent(sampleEvent);

      expect(outcome.action).toBe('CORRELATED_TO_EXISTING');
      expect(outcome.incidentId).toBe('inc-existing-123');
      expect(mockRepo.createIncident).not.toHaveBeenCalled();
      expect(mockRepo.linkAlertToIncident).toHaveBeenCalledWith('inc-existing-123', 'alert-101', 0.9);
      expect(mockDedupe.recordAlert).toHaveBeenCalledWith(sampleEvent.data.fingerprint, 'inc-existing-123');
    });

    it('should suppress duplicate alerts active within sliding window', async () => {
      vi.mocked(mockDedupe.checkDuplicate).mockResolvedValue({
        isDuplicate: true,
        associatedIncidentId: 'inc-deduped-456',
      });

      const outcome = await correlator.processEvent(sampleEvent);

      expect(outcome.action).toBe('DEDUPLICATED');
      expect(outcome.incidentId).toBe('inc-deduped-456');
      expect(mockRepo.createIncident).not.toHaveBeenCalled();
      expect(mockRepo.findActiveIncidentForService).not.toHaveBeenCalled();
      expect(mockRepo.linkAlertToIncident).toHaveBeenCalledWith('inc-deduped-456', 'alert-101', 1.0);
    });
  });
});
