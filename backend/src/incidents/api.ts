import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IncidentRepository, InvalidStateTransitionError, ConcurrencyConflictError } from './repository.js';
import { IncidentStatusEnum } from '../types/incidents.js';
import { logger } from '../utils/logger.js';

const TransitionStatusSchema = z.object({
  newStatus: IncidentStatusEnum,
  expectedVersion: z.number().int().min(1),
  actorId: z.string().uuid().optional(),
});

export const incidentRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const repo = new IncidentRepository();

  // 1. List Incidents
  fastify.get('/api/v1/incidents', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const incidents = await repo.listIncidents();
      return reply.status(200).send({
        incidents,
        total: incidents.length,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list incidents');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Could not retrieve incidents',
      });
    }
  });

  // 2. Get Incident by ID
  fastify.get('/api/v1/incidents/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      const incident = await repo.getIncidentById(id);
      if (!incident) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Incident ${id} not found`,
        });
      }

      const timeline = await repo.getTimeline(id);
      const alerts = await repo.getLinkedAlerts(id);

      return reply.status(200).send({
        incident,
        timeline,
        alerts,
      });
    } catch (err) {
      logger.error({ err, incidentId: id }, 'Failed to fetch incident details');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Could not fetch incident details',
      });
    }
  });

  // 3. Transition Incident Status
  fastify.patch('/api/v1/incidents/:id/status', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    let parsedBody;
    try {
      parsedBody = TransitionStatusSchema.parse(request.body);
    } catch (validationErr) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid request body',
        details: (validationErr as z.ZodError).errors,
      });
    }

    try {
      const updated = await repo.transitionStatus({
        incidentId: id,
        newStatus: parsedBody.newStatus,
        expectedVersion: parsedBody.expectedVersion,
        actorId: parsedBody.actorId,
      });

      return reply.status(200).send({
        status: 'success',
        incident: updated,
      });
    } catch (err) {
      if (err instanceof InvalidStateTransitionError) {
        return reply.status(409).send({
          error: 'Conflict',
          code: 'INVALID_STATE_TRANSITION',
          message: err.message,
          currentStatus: err.currentStatus,
          requestedStatus: err.requestedStatus,
        });
      }

      if (err instanceof ConcurrencyConflictError) {
        return reply.status(409).send({
          error: 'Conflict',
          code: 'CONCURRENCY_CONFLICT',
          message: err.message,
        });
      }

      logger.error({ err, incidentId: id }, 'Unexpected error during state transition');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to update incident state',
      });
    }
  });
};
