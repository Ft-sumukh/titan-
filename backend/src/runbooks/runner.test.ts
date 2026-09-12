import { describe, it, expect } from 'vitest';
import { RunbookRunner, RunbookValidationError } from './runner.js';
import { DualCustodyApprovalGate, UnauthorizedApprovalError } from './approvals.js';
import { RunbookDefinition } from './schema.js';

describe('Runbook Engine & Dual-Custody Approval', () => {
  const sampleRunbook: RunbookDefinition = {
    version: 'titan/v1alpha1',
    kind: 'Runbook',
    metadata: {
      id: 'rbk-restart-service',
      name: 'Restart Degrading Service',
      description: 'Issues a rolling restart for a target service',
      tags: ['restart', 'k8s'],
    },
    spec: {
      requires_approval: true,
      min_role: 'INCIDENT_COMMANDER',
      timeout_seconds: 120,
      parameters: [
        {
          name: 'targetService',
          type: 'string',
          required: true,
          validation_regex: '^[a-z0-9-]+$',
        },
        {
          name: 'replicaCount',
          type: 'integer',
          required: false,
          default: 3,
        },
      ],
      steps: [
        {
          id: 'step-1',
          name: 'Verify Pod Health',
          type: 'http_request',
          config: {
            method: 'GET',
            url: 'https://internal.corp/health?service=${targetService}',
            timeout_seconds: 10,
            retry_count: 0,
          },
          on_failure: 'abort',
        },
      ],
    },
  };

  describe('Parameter Validation & Interpolation', () => {
    const runner = new RunbookRunner();

    it('should validate and apply default parameters', () => {
      const validated = runner.validateParameters(sampleRunbook, {
        targetService: 'payment-gateway',
      });

      expect(validated.targetService).toBe('payment-gateway');
      expect(validated.replicaCount).toBe(3); // Default applied
    });

    it('should reject missing required parameter', () => {
      expect(() => runner.validateParameters(sampleRunbook, {})).toThrowError(
        RunbookValidationError
      );
    });

    it('should reject parameter failing regex constraint', () => {
      expect(() =>
        runner.validateParameters(sampleRunbook, {
          targetService: 'Payment;rm -rf /;',
        })
      ).toThrowError(/does not match validation regex/);
    });

    it('should interpolate variables into URLs', () => {
      const interpolated = runner.interpolate('https://api.corp/v1/pods/${targetService}/restart', {
        targetService: 'auth-service',
      });

      expect(interpolated).toBe('https://api.corp/v1/pods/auth-service/restart');
    });
  });

  describe('Dry-Run Simulation', () => {
    const runner = new RunbookRunner();

    it('should simulate execution safely without invoking external endpoints', async () => {
      const report = await runner.execute({
        executionId: 'exec-test-01',
        incidentId: '00000000-0000-0000-0000-000000000010',
        runbook: sampleRunbook,
        inputParameters: { targetService: 'checkout-service' },
        isDryRun: true,
      });

      expect(report.status).toBe('COMPLETED');
      expect(report.isDryRun).toBe(true);
      expect(report.steps).toHaveLength(1);
      expect(report.steps[0]?.output).toContain('[SIMULATION]');
      expect(report.steps[0]?.output).toContain('checkout-service');
    });
  });

  describe('Dual-Custody Approval Gate', () => {
    const gate = new DualCustodyApprovalGate();

    it('should approve when approver is a distinct Incident Commander', () => {
      const result = gate.validateApproval({
        requesterId: 'user-responder-01',
        approverId: 'user-commander-02',
        approverRole: 'INCIDENT_COMMANDER',
        runbookRequiresApproval: true,
      });

      expect(result.approved).toBe(true);
    });

    it('should reject when requester attempts to self-approve', () => {
      expect(() =>
        gate.validateApproval({
          requesterId: 'user-01',
          approverId: 'user-01',
          approverRole: 'INCIDENT_COMMANDER',
          runbookRequiresApproval: true,
        })
      ).toThrowError(UnauthorizedApprovalError);
    });

    it('should reject when approver has insufficient role', () => {
      expect(() =>
        gate.validateApproval({
          requesterId: 'user-responder-01',
          approverId: 'user-responder-02',
          approverRole: 'RESPONDER',
          runbookRequiresApproval: true,
        })
      ).toThrowError(/Insufficient role/);
    });
  });
});
