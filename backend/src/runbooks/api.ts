import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { RunbookRunner, RunbookValidationError } from './runner.js';
import { DualCustodyApprovalGate, UnauthorizedApprovalError } from './approvals.js';
import { RunbookDefinition, RunbookDefinitionSchema } from './schema.js';
import { UserRoleEnum } from '../types/incidents.js';
import { getDatabasePool } from '../infrastructure/database.js';
import { logger } from '../utils/logger.js';

const ExecuteRunbookSchema = z.object({
  runbookId: z.string().min(1),
  parameters: z.record(z.unknown()).default({}),
  requesterId: z.string().uuid().default('00000000-0000-0000-0000-000000000002'),
  isDryRun: z.boolean().default(false),
});

const ApproveExecutionSchema = z.object({
  approverId: z.string().uuid(),
  approverRole: UserRoleEnum,
});

// In-memory or database runbook catalog
const activeRunbooks = new Map<string, RunbookDefinition>([
  [
    'drain-and-scale-db-pool',
    RunbookDefinitionSchema.parse({
      version: 'titan/v1alpha1',
      kind: 'Runbook',
      metadata: {
        id: 'drain-and-scale-db-pool',
        name: 'Drain Blocked Queries & Scale Connection Pool',
        description: 'Terminates idle-in-transaction queries and scales database connection pool for degraded services.',
        tags: ['database', 'postgres', 'p1-mitigation'],
      },
      spec: {
        requires_approval: true,
        min_role: 'INCIDENT_COMMANDER',
        timeout_seconds: 180,
        parameters: [
          {
            name: 'targetService',
            type: 'string',
            required: true,
            default: 'payments-service',
            validation_regex: '^[a-z0-9-]+$',
          },
          {
            name: 'maxIdleSeconds',
            type: 'integer',
            required: true,
            default: 60,
          },
        ],
        steps: [
          {
            id: 'check-pool-health',
            name: 'Check Current Pool Health',
            type: 'http_request',
            config: {
              method: 'GET',
              url: 'https://internal.corp/api/v1/db-pool/status?service=${targetService}',
              timeout_seconds: 10,
              retry_count: 0,
            },
            on_failure: 'abort',
          },
          {
            id: 'terminate-idle',
            name: 'Terminate Idle Queries',
            type: 'http_request',
            config: {
              method: 'POST',
              url: 'https://internal.corp/api/v1/db-pool/terminate?service=${targetService}',
              body: { idleThreshold: '${maxIdleSeconds}' },
              timeout_seconds: 30,
              retry_count: 0,
            },
            on_failure: 'abort',
          },
        ],
      },
    }),
  ],
]);

// Track execution state in memory for fast retrieval
const executionsStore = new Map<
  string,
  {
    executionId: string;
    incidentId: string;
    runbookId: string;
    status: 'PENDING_APPROVAL' | 'COMPLETED' | 'FAILED';
    requesterId: string;
    approverId?: string;
    parameters: Record<string, unknown>;
    isDryRun: boolean;
    report?: unknown;
  }
>();

export const runbookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const runner = new RunbookRunner();
  const gate = new DualCustodyApprovalGate();
  const pool = getDatabasePool();

  // 1. List Available Runbooks
  fastify.get('/api/v1/runbooks', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      runbooks: Array.from(activeRunbooks.values()),
      total: activeRunbooks.size,
    });
  });

  // 2. Submit Runbook Execution Request
  fastify.post('/api/v1/incidents/:id/runbooks/exec', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: incidentId } = request.params;

    let parsedBody;
    try {
      parsedBody = ExecuteRunbookSchema.parse(request.body);
    } catch (err) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid runbook execution request',
        details: (err as z.ZodError).errors,
      });
    }

    const runbook = activeRunbooks.get(parsedBody.runbookId);
    if (!runbook) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Runbook '${parsedBody.runbookId}' not found`,
      });
    }

    const executionId = uuidv4();

    // If runbook requires approval and is NOT a dry-run
    if (runbook.spec.requires_approval && !parsedBody.isDryRun) {
      executionsStore.set(executionId, {
        executionId,
        incidentId,
        runbookId: runbook.metadata.id,
        status: 'PENDING_APPROVAL',
        requesterId: parsedBody.requesterId,
        parameters: parsedBody.parameters,
        isDryRun: false,
      });

      logger.info(
        { executionId, incidentId, runbookId: runbook.metadata.id, requesterId: parsedBody.requesterId },
        'Runbook execution requires dual-custody approval'
      );

      return reply.status(202).send({
        status: 'PENDING_APPROVAL',
        executionId,
        incidentId,
        runbookId: runbook.metadata.id,
        message: 'Dual-custody approval required before execution can proceed',
      });
    }

    // Execute immediately (dry-run or pre-approved)
    try {
      const report = await runner.execute({
        executionId,
        incidentId,
        runbook,
        inputParameters: parsedBody.parameters,
        isDryRun: parsedBody.isDryRun,
      });

      executionsStore.set(executionId, {
        executionId,
        incidentId,
        runbookId: runbook.metadata.id,
        status: report.status,
        requesterId: parsedBody.requesterId,
        parameters: parsedBody.parameters,
        isDryRun: parsedBody.isDryRun,
        report,
      });

      return reply.status(200).send({
        status: report.status,
        executionId,
        report,
      });
    } catch (err) {
      if (err instanceof RunbookValidationError) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: err.message,
        });
      }

      logger.error({ err, executionId }, 'Runbook execution failed');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to execute runbook',
      });
    }
  });

  // 3. Dual-Custody Approval Endpoint
  fastify.post('/api/v1/executions/:id/approve', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: executionId } = request.params;

    let parsedBody;
    try {
      parsedBody = ApproveExecutionSchema.parse(request.body);
    } catch (err) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid approval request payload',
        details: (err as z.ZodError).errors,
      });
    }

    const pending = executionsStore.get(executionId);
    if (!pending) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Execution request '${executionId}' not found`,
      });
    }

    if (pending.status !== 'PENDING_APPROVAL') {
      return reply.status(409).send({
        error: 'Conflict',
        message: `Execution request is not in PENDING_APPROVAL state (current: ${pending.status})`,
      });
    }

    const runbook = activeRunbooks.get(pending.runbookId)!;

    // Validate Dual-Custody Rules
    try {
      gate.validateApproval({
        requesterId: pending.requesterId,
        approverId: parsedBody.approverId,
        approverRole: parsedBody.approverRole,
        runbookRequiresApproval: runbook.spec.requires_approval,
      });
    } catch (err) {
      if (err instanceof UnauthorizedApprovalError) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: err.message,
        });
      }
      throw err;
    }

    // Execute runbook
    pending.approverId = parsedBody.approverId;
    const report = await runner.execute({
      executionId,
      incidentId: pending.incidentId,
      runbook,
      inputParameters: pending.parameters,
      isDryRun: false,
    });

    pending.status = report.status;
    pending.report = report;

    // Append to audit log in PostgreSQL if available
    try {
      await pool.query(
        `
        INSERT INTO audit_logs (
          tenant_id, actor_id, actor_ip, action, entity_type, entity_id,
          before_state, after_state, prev_hash, row_hash
        )
        VALUES (
          '00000000-0000-0000-0000-000000000001', $1, $2, 'RUNBOOK_APPROVED_AND_EXECUTED',
          'RUNBOOK_EXECUTION', $3, $4, $5, '0'.repeat(64), '0'.repeat(64)
        );
      `,
        [
          parsedBody.approverId,
          request.ip,
          executionId,
          JSON.stringify({ status: 'PENDING_APPROVAL', requesterId: pending.requesterId }),
          JSON.stringify({ status: report.status, approverId: parsedBody.approverId, report }),
        ]
      );
    } catch (auditErr) {
      logger.warn({ auditErr }, 'Could not persist audit log to DB (table may be pending migration)');
    }

    return reply.status(200).send({
      status: report.status,
      executionId,
      approvedBy: parsedBody.approverId,
      report,
    });
  });

  // 4. Get Execution Status
  fastify.get('/api/v1/executions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id: executionId } = request.params;
    const record = executionsStore.get(executionId);

    if (!record) {
      return reply.status(404).send({
        error: 'Not Found',
        message: `Execution '${executionId}' not found`,
      });
    }

    return reply.status(200).send(record);
  });
};
