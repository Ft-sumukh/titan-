import pg from 'pg';
import { getDatabasePool } from '../infrastructure/database.js';
import {
  IncidentRecord,
  IncidentStatus,
  IncidentPriority,
  isValidTransition,
} from '../types/incidents.js';
import { logger } from '../utils/logger.js';
import { TitanCloudEvent } from '../types/cloudevents.js';

export class InvalidStateTransitionError extends Error {
  constructor(public currentStatus: IncidentStatus, public requestedStatus: IncidentStatus) {
    super(`Cannot transition incident from '${currentStatus}' to '${requestedStatus}'`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class ConcurrencyConflictError extends Error {
  constructor(public incidentId: string, public expectedVersion: number) {
    super(`Concurrent update conflict on incident ${incidentId} (expected version ${expectedVersion})`);
    this.name = 'ConcurrencyConflictError';
  }
}

export class IncidentRepository {
  private pool: pg.Pool;

  constructor(pool?: pg.Pool) {
    this.pool = pool || getDatabasePool();
  }

  /**
   * Find an active, open incident for a given service and environment.
   */
  async findActiveIncidentForService(
    tenantId: string,
    serviceName: string,
    environment: string
  ): Promise<IncidentRecord | null> {
    const query = `
      SELECT * FROM incidents
      WHERE tenant_id = $1
        AND service_name = $2
        AND environment = $3
        AND status IN ('TRIGGERED', 'ACKNOWLEDGED', 'INVESTIGATING', 'MITIGATING')
      ORDER BY triggered_at DESC
      LIMIT 1;
    `;

    const result = await this.pool.query(query, [tenantId, serviceName, environment]);
    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as IncidentRecord;
  }

  /**
   * Create a new canonical Incident record.
   */
  async createIncident(params: {
    tenantId: string;
    title: string;
    summary: string;
    priority: IncidentPriority;
    serviceName: string;
    environment: string;
  }): Promise<IncidentRecord> {
    const query = `
      INSERT INTO incidents (
        tenant_id, title, summary, status, priority,
        service_name, environment, alert_count, version, triggered_at
      )
      VALUES ($1, $2, $3, 'TRIGGERED', $4, $5, $6, 1, 1, NOW())
      RETURNING *;
    `;

    const result = await this.pool.query(query, [
      params.tenantId,
      params.title,
      params.summary,
      params.priority,
      params.serviceName,
      params.environment,
    ]);

    const incident = result.rows[0] as IncidentRecord;
    logger.info({ incidentId: incident.id, incidentNumber: incident.incident_number, title: incident.title }, 'Created canonical incident');
    return incident;
  }

  /**
   * Save an incoming alert record into PostgreSQL.
   */
  async saveAlert(event: TitanCloudEvent): Promise<string> {
    const query = `
      INSERT INTO alerts (
        tenant_id, event_id, fingerprint, source, alert_name,
        severity, service, environment, payload, received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (event_id) DO UPDATE
        SET payload = EXCLUDED.payload
      RETURNING id;
    `;

    const result = await this.pool.query(query, [
      event.tenantId,
      event.id,
      event.data.fingerprint,
      event.source,
      event.data.alertName,
      event.data.severity,
      event.data.service,
      event.data.environment,
      JSON.stringify(event),
      event.time,
    ]);

    return (result.rows[0] as { id: string }).id;
  }

  /**
   * Link an alert to an incident and increment incident's alert count.
   */
  async linkAlertToIncident(incidentId: string, alertId: string, score: number = 1.0): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert correlation junction record
      await client.query(
        `
        INSERT INTO incident_alerts (incident_id, alert_id, correlation_score, linked_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (incident_id, alert_id) DO NOTHING;
      `,
        [incidentId, alertId, score]
      );

      // 2. Increment alert counter on incident
      await client.query(
        `
        UPDATE incidents
        SET alert_count = alert_count + 1,
            updated_at = NOW()
        WHERE id = $1;
      `,
        [incidentId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically transitions an incident's state with optimistic locking and validation.
   */
  async transitionStatus(params: {
    incidentId: string;
    newStatus: IncidentStatus;
    expectedVersion: number;
    actorId?: string;
  }): Promise<IncidentRecord> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Fetch current incident state
      const fetchQuery = `SELECT * FROM incidents WHERE id = $1 FOR UPDATE;`;
      const fetchResult = await client.query(fetchQuery, [params.incidentId]);

      if (fetchResult.rows.length === 0) {
        throw new Error(`Incident not found: ${params.incidentId}`);
      }

      const current = fetchResult.rows[0] as IncidentRecord;

      // 2. Check optimistic concurrency version
      if (current.version !== params.expectedVersion) {
        throw new ConcurrencyConflictError(params.incidentId, params.expectedVersion);
      }

      // 3. Validate state machine rules
      if (!isValidTransition(current.status, params.newStatus)) {
        throw new InvalidStateTransitionError(current.status, params.newStatus);
      }

      // 4. Update timestamps based on target state
      let timestampUpdate = '';
      if (params.newStatus === 'ACKNOWLEDGED' && !current.acknowledged_at) {
        timestampUpdate = `, acknowledged_at = NOW(), lead_responder_id = COALESCE(lead_responder_id, '${params.actorId || ''}')`;
      } else if (params.newStatus === 'MITIGATING' && !current.mitigated_at) {
        timestampUpdate = `, mitigated_at = NOW()`;
      } else if (params.newStatus === 'RESOLVED' && !current.resolved_at) {
        timestampUpdate = `, resolved_at = NOW()`;
      } else if (params.newStatus === 'CLOSED' && !current.closed_at) {
        timestampUpdate = `, closed_at = NOW()`;
      }

      const updateQuery = `
        UPDATE incidents
        SET status = $1,
            version = version + 1,
            updated_at = NOW()
            ${timestampUpdate}
        WHERE id = $2 AND version = $3
        RETURNING *;
      `;

      const updateResult = await client.query(updateQuery, [
        params.newStatus,
        params.incidentId,
        params.expectedVersion,
      ]);

      const updated = updateResult.rows[0] as IncidentRecord;

      // 5. Append timeline event
      await client.query(
        `
        INSERT INTO timeline_events (incident_id, actor_id, event_type, content, metadata)
        VALUES ($1, $2, 'STATUS_CHANGE', $3, $4);
      `,
        [
          params.incidentId,
          params.actorId || null,
          `Status changed from ${current.status} to ${params.newStatus}`,
          JSON.stringify({ previousStatus: current.status, newStatus: params.newStatus }),
        ]
      );

      await client.query('COMMIT');

      logger.info(
        { incidentId: updated.id, from: current.status, to: params.newStatus, version: updated.version },
        'Incident status transition complete'
      );

      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve incident by ID.
   */
  async getIncidentById(id: string): Promise<IncidentRecord | null> {
    const query = `SELECT * FROM incidents WHERE id = $1;`;
    const result = await this.pool.query(query, [id]);
    return (result.rows[0] as IncidentRecord) || null;
  }

  /**
   * List incidents ordered by triggered_at descending.
   */
  async listIncidents(limit: number = 50): Promise<IncidentRecord[]> {
    const query = `
      SELECT * FROM incidents
      ORDER BY triggered_at DESC
      LIMIT $1;
    `;
    const result = await this.pool.query(query, [limit]);
    return result.rows as IncidentRecord[];
  }

  /**
   * Get timeline events for an incident.
   */
  async getTimeline(incidentId: string): Promise<unknown[]> {
    const query = `SELECT * FROM timeline_events WHERE incident_id = $1 ORDER BY created_at ASC;`;
    const result = await this.pool.query(query, [incidentId]);
    return result.rows;
  }

  /**
   * Get alerts linked to an incident.
   */
  async getLinkedAlerts(incidentId: string): Promise<unknown[]> {
    const query = `
      SELECT a.*, ia.correlation_score, ia.linked_at
      FROM alerts a
      JOIN incident_alerts ia ON ia.alert_id = a.id
      WHERE ia.incident_id = $1
      ORDER BY ia.linked_at DESC;
    `;
    const result = await this.pool.query(query, [incidentId]);
    return result.rows;
  }
}
