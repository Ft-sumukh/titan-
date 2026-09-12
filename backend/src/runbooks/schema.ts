import { z } from 'zod';

/**
 * Declarative YAML Runbook Schema (titan/v1alpha1)
 */

export const RunbookParameterSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_]+$/, 'Parameter name must be alphanumeric or underscore'),
  type: z.enum(['string', 'integer', 'boolean']),
  required: z.boolean().default(true),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  validation_regex: z.string().optional(),
  description: z.string().optional(),
});

export type RunbookParameter = z.infer<typeof RunbookParameterSchema>;

export const RunbookStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['http_request', 'system_check']),
  config: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('POST'),
    url: z.string().url('Step URL must be a valid URL'),
    headers: z.record(z.string()).optional().default({}),
    body: z.union([z.record(z.unknown()), z.string()]).optional(),
    timeout_seconds: z.number().int().min(1).max(120).default(30),
    retry_count: z.number().int().min(0).max(5).default(0),
  }),
  assert: z
    .object({
      status_code: z.number().int().optional(),
    })
    .optional(),
  on_failure: z.enum(['abort', 'continue']).default('abort'),
});

export type RunbookStep = z.infer<typeof RunbookStepSchema>;

export const RunbookDefinitionSchema = z.object({
  version: z.literal('titan/v1alpha1'),
  kind: z.literal('Runbook'),
  metadata: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
  spec: z.object({
    requires_approval: z.boolean().default(false),
    min_role: z.enum(['ADMIN', 'INCIDENT_COMMANDER', 'RESPONDER', 'OBSERVER']).default('RESPONDER'),
    timeout_seconds: z.number().int().min(5).max(1800).default(300),
    parameters: z.array(RunbookParameterSchema).default([]),
    steps: z.array(RunbookStepSchema).min(1, 'Runbook must have at least one step'),
  }),
});

export type RunbookDefinition = z.infer<typeof RunbookDefinitionSchema>;
