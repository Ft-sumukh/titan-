import { getRedisClient } from '../infrastructure/redis.js';
import { logger } from '../utils/logger.js';

export interface DeduplicationResult {
  isDuplicate: boolean;
  associatedIncidentId?: string;
}

export class AlertDeduplicator {
  private prefix = 'alert:dedupe:';
  private windowSeconds: number;

  constructor(windowSeconds: number = 300) {
    this.windowSeconds = windowSeconds;
  }

  /**
   * Check if an alert with identical fingerprint was recently seen.
   */
  async checkDuplicate(fingerprint: string): Promise<DeduplicationResult> {
    const redis = getRedisClient();
    const key = `${this.prefix}${fingerprint}`;

    const existingIncidentId = await redis.get(key);

    if (existingIncidentId) {
      logger.debug({ fingerprint, existingIncidentId }, 'Duplicate alert identified within sliding window');
      return {
        isDuplicate: true,
        associatedIncidentId: existingIncidentId,
      };
    }

    return { isDuplicate: false };
  }

  /**
   * Record alert fingerprint in the sliding window and link it to the incident ID.
   */
  async recordAlert(fingerprint: string, incidentId: string): Promise<void> {
    const redis = getRedisClient();
    const key = `${this.prefix}${fingerprint}`;
    await redis.set(key, incidentId, 'EX', this.windowSeconds);
    logger.debug({ fingerprint, incidentId, ttl: this.windowSeconds }, 'Recorded alert fingerprint in sliding window');
  }
}
