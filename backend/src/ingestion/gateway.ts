import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { verifyHmacSignature, isTimestampValid } from '../utils/crypto.js';
import { parseGenericAlert } from './adapters/generic.js';
import { parsePrometheusAlerts } from './adapters/prometheus.js';
import { parseDatadogAlert } from './adapters/datadog.js';
import { enqueueTelemetryEvent } from '../infrastructure/redis.js';
import { TitanCloudEvent, TitanCloudEventSchema } from '../types/cloudevents.js';
import { logger } from '../utils/logger.js';
import { z } from 'zod';

export interface IngressWebhookHeaders {
  'x-titan-signature'?: string;
  'x-titan-timestamp'?: string;
  'x-titan-source'?: 'prometheus' | 'datadog' | 'generic';
}

export const ingestionRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Webhook Ingress Route
  fastify.post(
    '/api/v1/ingress/webhook',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const headers = request.headers as IngressWebhookHeaders;
      const signature = headers['x-titan-signature'];
      const timestamp = headers['x-titan-timestamp'];
      const source = (headers['x-titan-source'] || 'generic').toLowerCase();

      // 1. Signature Verification
      if (!signature) {
        logger.warn({ ip: request.ip }, 'Rejected webhook: Missing X-Titan-Signature header');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Missing required X-Titan-Signature header',
        });
      }

      const rawBody = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      const isSignatureValid = verifyHmacSignature(rawBody, signature);

      if (!isSignatureValid) {
        logger.warn({ ip: request.ip, source }, 'Rejected webhook: Invalid HMAC signature');
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid HMAC signature',
        });
      }

      // 2. Replay Attack Prevention
      if (timestamp) {
        const timeCheck = isTimestampValid(timestamp);
        if (!timeCheck.valid) {
          logger.warn({ ip: request.ip, timestamp, reason: timeCheck.reason }, 'Rejected webhook: Timestamp validation failed');
          return reply.status(400).send({
            error: 'Bad Request',
            message: `Timestamp check failed: ${timeCheck.reason}`,
          });
        }
      }

      // 3. Adapter Dispatch & Normalization
      let cloudEvents: TitanCloudEvent[] = [];

      try {
        switch (source) {
          case 'prometheus':
            cloudEvents = parsePrometheusAlerts(request.body, request.ip);
            break;
          case 'datadog':
            cloudEvents = parseDatadogAlert(request.body, request.ip);
            break;
          case 'generic':
          default:
            cloudEvents = parseGenericAlert(request.body, request.ip);
            break;
        }
      } catch (err: unknown) {
        if (err instanceof z.ZodError) {
          logger.warn({ ip: request.ip, errors: err.errors }, 'Webhook payload schema validation failed');
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Payload schema validation failed',
            details: err.errors,
          });
        }

        logger.error({ err, ip: request.ip }, 'Unexpected error parsing webhook payload');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to normalize alert payload',
        });
      }

      // 4. Validate CloudEvents and Enqueue to Redis Streams
      const eventIds: string[] = [];

      for (const event of cloudEvents) {
        // Strict contract check
        TitanCloudEventSchema.parse(event);

        try {
          await enqueueTelemetryEvent(event);
          eventIds.push(event.id);
        } catch (enqueueErr) {
          logger.error({ enqueueErr, eventId: event.id }, 'Failed to enqueue CloudEvent to Redis Streams');
          return reply.status(503).send({
            error: 'Service Unavailable',
            message: 'Telemetry ingestion buffer temporarily unavailable',
          });
        }
      }

      logger.info(
        { count: eventIds.length, source, eventIds, ip: request.ip },
        'Ingested and enqueued telemetry alert(s)'
      );

      return reply.status(202).send({
        status: 'accepted',
        count: eventIds.length,
        eventIds,
        timestamp: new Date().toISOString(),
      });
    }
  );

  // Health Check Endpoint
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      status: 'ok',
      service: 'titan-gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
};
