import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { ingestionRoutes } from './ingestion/gateway.js';
import { incidentRoutes } from './incidents/api.js';
import { runbookRoutes } from './runbooks/api.js';
import { webSocketRoutes } from './websocket/hub.js';
import { getRedisClient, setupTelemetryConsumerGroup } from './infrastructure/redis.js';
import { checkDatabaseHealth, closeDatabasePool } from './infrastructure/database.js';

export async function buildServer() {
  const fastify = Fastify({
    loggerInstance: logger,
    bodyLimit: 1048576, // 1MB maximum payload size
    trustProxy: true,
  });

  // CORS Middleware
  await fastify.register(cors, {
    origin: config.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // Rate Limiting (Token Bucket)
  await fastify.register(rateLimit, {
    max: config.WEBHOOK_RATE_LIMIT_BURST,
    timeWindow: '1 minute',
  });

  // Register WebSocket Engine
  await fastify.register(fastifyWebsocket);

  // Register Application Plugins
  await fastify.register(ingestionRoutes);
  await fastify.register(incidentRoutes);
  await fastify.register(runbookRoutes);
  await fastify.register(webSocketRoutes);

  return fastify;
}

async function start() {
  try {
    const server = await buildServer();

    // Verify Redis connection and consumer group
    const redis = getRedisClient();
    await redis.connect();
    await setupTelemetryConsumerGroup();

    // Verify DB health
    const dbHealthy = await checkDatabaseHealth();
    if (dbHealthy) {
      logger.info('Database connection verified');
    } else {
      logger.warn('Database connection check failed or pending initial migration');
    }

    // Start listening
    const address = await server.listen({
      port: config.GATEWAY_PORT,
      host: '0.0.0.0',
    });

    logger.info({ address, port: config.GATEWAY_PORT }, '🚀 TITAN Ingestion Gateway running');

    // Graceful Shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info({ signal }, 'Received termination signal, starting graceful shutdown...');
        await server.close();
        await redis.quit();
        await closeDatabasePool();
        logger.info('TITAN gracefully stopped');
        process.exit(0);
      });
    }
  } catch (err) {
    logger.fatal({ err }, 'Fatal error during TITAN startup');
    process.exit(1);
  }
}

// Auto-start only when executed directly
if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  start();
}
