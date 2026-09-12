import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../index.js';
import * as dbModule from '../infrastructure/database.js';

describe('Runbook Execution & Approval API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dbModule, 'getDatabasePool').mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as any);
  });

  it('GET /api/v1/runbooks should return catalog of registered runbooks', async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/runbooks',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.runbooks.length).toBeGreaterThan(0);
    expect(body.runbooks[0].metadata.id).toBe('drain-and-scale-db-pool');
  });

  it('POST /api/v1/incidents/:id/runbooks/exec should execute immediately in dry-run mode', async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000010/runbooks/exec',
      payload: {
        runbookId: 'drain-and-scale-db-pool',
        parameters: { targetService: 'payments-service', maxIdleSeconds: 30 },
        isDryRun: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('COMPLETED');
    expect(body.report.isDryRun).toBe(true);
    expect(body.report.steps[0].output).toContain('[SIMULATION]');
  });

  it('POST /api/v1/incidents/:id/runbooks/exec should queue for dual-custody approval for live run', async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000010/runbooks/exec',
      payload: {
        runbookId: 'drain-and-scale-db-pool',
        requesterId: '00000000-0000-0000-0000-000000000002',
        parameters: { targetService: 'payments-service' },
        isDryRun: false,
      },
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe('PENDING_APPROVAL');
    expect(body.executionId).toBeDefined();

    // Attempt self-approval (should fail with 403)
    const selfApproveResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/executions/${body.executionId}/approve`,
      payload: {
        approverId: '00000000-0000-0000-0000-000000000002', // Same as requester
        approverRole: 'INCIDENT_COMMANDER',
      },
    });

    expect(selfApproveResponse.statusCode).toBe(403);
    expect(selfApproveResponse.json().message).toContain('requester cannot approve');

    // Attempt valid approval with distinct Incident Commander
    // Mock global fetch for live step execution
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      text: vi.fn().mockResolvedValue('{"status":"OK"}'),
    } as any);

    const validApproveResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/executions/${body.executionId}/approve`,
      payload: {
        approverId: '00000000-0000-0000-0000-000000000005', // Distinct user
        approverRole: 'INCIDENT_COMMANDER',
      },
    });

    expect(validApproveResponse.statusCode).toBe(200);
    const approveBody = validApproveResponse.json();
    expect(approveBody.status).toBe('COMPLETED');
    expect(approveBody.approvedBy).toBe('00000000-0000-0000-0000-000000000005');
  });
});
