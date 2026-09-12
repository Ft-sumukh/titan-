import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../index.js';
import { IncidentRepository, InvalidStateTransitionError, ConcurrencyConflictError } from './repository.js';

describe('Incident Management REST API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/v1/incidents should return list of incidents', async () => {
    const mockIncidents = [
      {
        id: '00000000-0000-0000-0000-000000000010',
        title: '[P1] Database Connection Saturation',
        status: 'TRIGGERED',
        priority: 'P1',
        service_name: 'payments',
      },
    ];

    vi.spyOn(IncidentRepository.prototype, 'listIncidents').mockResolvedValue(mockIncidents as any);

    const server = await buildServer();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/incidents',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.incidents).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(body.incidents[0].title).toContain('Database Connection Saturation');
  });

  it('GET /api/v1/incidents/:id should return 404 if incident does not exist', async () => {
    vi.spyOn(IncidentRepository.prototype, 'getIncidentById').mockResolvedValue(null);

    const server = await buildServer();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000099',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toContain('not found');
  });

  it('PATCH /api/v1/incidents/:id/status should return 409 Conflict on illegal transition', async () => {
    vi.spyOn(IncidentRepository.prototype, 'transitionStatus').mockRejectedValue(
      new InvalidStateTransitionError('TRIGGERED', 'CLOSED')
    );

    const server = await buildServer();
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000010/status',
      payload: {
        newStatus: 'CLOSED',
        expectedVersion: 1,
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.code).toBe('INVALID_STATE_TRANSITION');
    expect(body.currentStatus).toBe('TRIGGERED');
    expect(body.requestedStatus).toBe('CLOSED');
  });

  it('PATCH /api/v1/incidents/:id/status should return 409 Conflict on concurrent version collision', async () => {
    vi.spyOn(IncidentRepository.prototype, 'transitionStatus').mockRejectedValue(
      new ConcurrencyConflictError('00000000-0000-0000-0000-000000000010', 1)
    );

    const server = await buildServer();
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000010/status',
      payload: {
        newStatus: 'ACKNOWLEDGED',
        expectedVersion: 1,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('CONCURRENCY_CONFLICT');
  });

  it('PATCH /api/v1/incidents/:id/status should return 200 OK on valid transition', async () => {
    const mockUpdated = {
      id: '00000000-0000-0000-0000-000000000010',
      status: 'ACKNOWLEDGED',
      version: 2,
      service_name: 'payments',
    };

    vi.spyOn(IncidentRepository.prototype, 'transitionStatus').mockResolvedValue(mockUpdated as any);

    const server = await buildServer();
    const response = await server.inject({
      method: 'PATCH',
      url: '/api/v1/incidents/00000000-0000-0000-0000-000000000010/status',
      payload: {
        newStatus: 'ACKNOWLEDGED',
        expectedVersion: 1,
        actorId: '00000000-0000-0000-0000-000000000002',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('success');
    expect(body.incident.status).toBe('ACKNOWLEDGED');
    expect(body.incident.version).toBe(2);
  });
});
