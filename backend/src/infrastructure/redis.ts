import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { TitanCloudEvent } from '../types/cloudevents.js';

export const TELEMETRY_STREAM_KEY = 'stream:telemetry:raw';
export const CORRELATION_CONSUMER_GROUP = 'cg:correlation-workers';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        logger.warn({ times, delay }, 'Redis connection retry initiated');
        return delay;
      },
      lazyConnect: true,
    });

    redisClient.on('connect', () => {
      logger.info('Connected to Redis');
    });

    redisClient.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });
  }

  return redisClient;
}

/**
 * Publishes a normalized CloudEvent to the durable Redis Stream.
 */
export async function enqueueTelemetryEvent(event: TitanCloudEvent): Promise<string> {
  const redis = getRedisClient();
  const serialized = JSON.stringify(event);

  // XADD stream:telemetry:raw * event <json>
  const messageId = await redis.xadd(
    TELEMETRY_STREAM_KEY,
    'MAXLEN',
    '~',
    100000, // Bound stream size to 100,000 items
    '*',
    'event_id',
    event.id,
    'fingerprint',
    event.data.fingerprint,
    'payload',
    serialized
  );

  if (!messageId) {
    throw new Error('Failed to enqueue event into Redis Stream');
  }

  return messageId;
}

/**
 * Initializes the Redis Consumer Group if it does not already exist.
 */
export async function setupTelemetryConsumerGroup(): Promise<void> {
  const redis = getRedisClient();
  try {
    // XGROUP CREATE stream:telemetry:raw cg:correlation-workers $ MKSTREAM
    await redis.xgroup('CREATE', TELEMETRY_STREAM_KEY, CORRELATION_CONSUMER_GROUP, '$', 'MKSTREAM');
    logger.info({ stream: TELEMETRY_STREAM_KEY, group: CORRELATION_CONSUMER_GROUP }, 'Created Redis Consumer Group');
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || '';
    if (errorMsg.includes('BUSYGROUP')) {
      logger.debug('Redis Consumer Group already exists');
    } else {
      logger.error({ err }, 'Error creating Redis Consumer Group');
      throw err;
    }
  }
}
