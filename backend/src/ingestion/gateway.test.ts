import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildServer } from '../index.js';
import { computeHmacSha256 } from '../utils/crypto.js';
import * as redisModule from '../infrastructure/redis.js';

describe('Ingestion Gateway API', () => {
  const secret = 'titan_webhook_default_hmac_secret_key_change_me';

  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock Redis Streams enqueue
    vi.spyOn(redisModule, 'enqueueTelemetryEvent').mockResolvedValue('1726156800000-0');
  });

  it('GET /health should return 200 OK and uptime info', async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: 'GET',
      url: 'health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('titan-gateway');
  });

  it('POST /api/v1/ingress/webhook should return 401 when signature header is missing', async () => {
    const server = await buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ingress/webhook',
      payload: {
        alertName: 'HighCPU',
        service: 'payments',
        summary: 'CPU > 90%',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain('Missing required X-Titan-Signature');
  });

  it('POST /api/v1/ingress/webhook should return 401 when HMAC signature is invalid', async () => {
    const server = await buildServer();
    const payload = {
      alertName: 'HighCPU',
      service: 'payments',
      summary: 'CPU > 90%',
    };

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ingress/webhook',
      headers: {
        'x-titan-signature': 'sha256=invalidhexsignature0000000000000000000000000000000000000000000000',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toContain('Invalid HMAC signature');
  });

  it('POST /api/v1/ingress/webhook should return 400 when timestamp exceeds replay window', async () => {
    const server = await buildServer();
    const payload = {
      alertName: 'HighCPU',
      service: 'payments',
      summary: 'CPU > 90%',
    };
    const rawBody = JSON.stringify(payload);
    const signature = computeHmacSha256(rawBody, secret);
    const expiredTimestamp = new Date(Date.now() - 600 * 1000).toISOString();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ingress/webhook',
      headers: {
        'x-titan-signature': signature,
        'x-titan-timestamp': expiredTimestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('Timestamp check failed');
  });

  it('POST /api/v1/ingress/webhook should accept valid Generic alert and enqueue to Redis Streams', async () => {
    const server = await buildServer();
    const payload = {
      alertName: 'DatabasePoolExhausted',
      severity: 'CRITICAL',
      status: 'firing',
      service: 'checkout-service',
      environment: 'production',
      summary: 'PostgreSQL connection pool 98% full',
    };

    const rawBody = JSON.stringify(payload);
    const signature = computeHmacSha256(rawBody, secret);
    const now = new Date().toISOString();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ingress/webhook',
      headers: {
        'x-titan-signature': signature,
        'x-titan-timestamp': now,
        'x-titan-source': 'generic',
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe('accepted');
    expect(body.count).toBe(1);
    expect(body.eventIds).toHaveLength(1);
    expect(redisModule.enqueueTelemetryEvent).toHaveBeenCalledOnce();
  });

  it('POST /api/v1/ingress/webhook should accept and normalize Prometheus Alertmanager storm', async () => {
    const server = await buildServer();
    const payload = {
      receiver: 'titan-ingress',
      status: 'firing',
      alerts: [
        {
          status: 'firing',
          labels: {
            alertname: 'KubePodCrashLooping',
            severity: 'critical',
            service: 'auth-service',
            env: 'production',
            cluster: 'prod-us-east-1',
          },
          annotations: {
            summary: 'Auth service pod is crashlooping',
          },
          startsAt: new Date().toISOString(),
        },
        {
          status: 'firing',
          labels: {
            alertname: 'HighLatencyP99',
            severity: 'warning',
            service: 'auth-service',
            env: 'production',
            cluster: 'prod-us-east-1',
          },
          annotations: {
            summary: 'Auth endpoint latency exceeded 500ms',
          },
          startsAt: new Date().toISOString(),
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = computeHmacSha256(rawBody, secret);

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/ingress/webhook',
      headers: {
        'x-titan-signature': signature,
        'x-titan-source': 'prometheus',
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe('accepted');
    expect(body.count).toBe(2);
    expect(body.eventIds).toHaveLength(2);
    expect(redisModule.enqueueTelemetryEvent).toHaveBeenCalledTimes(2);
  });
});
