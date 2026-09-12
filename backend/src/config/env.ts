import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file into process.env
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Ports
  GATEWAY_PORT: z.coerce.number().default(8080),
  API_PORT: z.coerce.number().default(8000),
  WS_PORT: z.coerce.number().default(8081),

  // Database
  DATABASE_URL: z.string().default('postgresql://titan_admin:titan_secure_password_123@localhost:5432/titan_db'),
  DB_POOL_MIN: z.coerce.number().default(2),
  DB_POOL_MAX: z.coerce.number().default(20),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Security & Crypto
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long').default('titan_development_jwt_secret_must_be_at_least_32_bytes_long!'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY_HEX: z.string().length(64, 'ENCRYPTION_KEY_HEX must be a 32-byte (64 hex char) string').default('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),

  // Ingress Webhooks
  WEBHOOK_HMAC_SECRET: z.string().default('titan_webhook_default_hmac_secret_key_change_me'),
  WEBHOOK_RATE_LIMIT_BURST: z.coerce.number().default(1000),
  WEBHOOK_RATE_LIMIT_RATE: z.coerce.number().default(500),

  // CORS
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Critical: Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }
  return result.data;
}

export const config = parseEnv();
