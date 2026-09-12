import { RunbookDefinition, RunbookStep } from './schema.js';
import { broadcastToWarRoom } from '../websocket/hub.js';
import { logger } from '../utils/logger.js';

export interface StepExecutionResult {
  stepId: string;
  stepName: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  output: string;
  error?: string;
}

export interface RunbookExecutionReport {
  executionId: string;
  runbookId: string;
  status: 'COMPLETED' | 'FAILED';
  isDryRun: boolean;
  totalDurationMs: number;
  steps: StepExecutionResult[];
}

export class RunbookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunbookValidationError';
  }
}

export class RunbookRunner {
  /**
   * Validate parameters provided for a runbook execution.
   */
  validateParameters(
    runbook: RunbookDefinition,
    providedParams: Record<string, unknown>
  ): Record<string, string | number | boolean> {
    const validated: Record<string, string | number | boolean> = {};

    for (const paramDef of runbook.spec.parameters) {
      const val = providedParams[paramDef.name] ?? paramDef.default;

      if (val === undefined || val === null) {
        if (paramDef.required) {
          throw new RunbookValidationError(`Missing required parameter: '${paramDef.name}'`);
        }
        continue;
      }

      if (paramDef.type === 'string') {
        const strVal = String(val);
        if (paramDef.validation_regex) {
          const regex = new RegExp(paramDef.validation_regex);
          if (!regex.test(strVal)) {
            throw new RunbookValidationError(
              `Parameter '${paramDef.name}' does not match validation regex: ${paramDef.validation_regex}`
            );
          }
        }
        validated[paramDef.name] = strVal;
      } else if (paramDef.type === 'integer') {
        const numVal = Number(val);
        if (!Number.isInteger(numVal)) {
          throw new RunbookValidationError(`Parameter '${paramDef.name}' must be an integer`);
        }
        validated[paramDef.name] = numVal;
      } else if (paramDef.type === 'boolean') {
        validated[paramDef.name] = Boolean(val);
      }
    }

    return validated;
  }

  /**
   * Interpolate ${paramName} in templates.
   */
  interpolate(template: string, params: Record<string, string | number | boolean>): string {
    return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      return params[key] !== undefined ? String(params[key]) : `\${${key}}`;
    });
  }

  /**
   * Execute a runbook (supports dry-run simulation mode).
   */
  async execute(params: {
    executionId: string;
    incidentId: string;
    runbook: RunbookDefinition;
    inputParameters: Record<string, unknown>;
    isDryRun?: boolean;
  }): Promise<RunbookExecutionReport> {
    const startTime = Date.now();
    const isDryRun = params.isDryRun ?? false;
    const validatedParams = this.validateParameters(params.runbook, params.inputParameters);

    logger.info(
      { executionId: params.executionId, runbookId: params.runbook.metadata.id, isDryRun },
      'Starting runbook execution'
    );

    const stepResults: StepExecutionResult[] = [];
    let overallSuccess = true;

    for (const step of params.runbook.spec.steps) {
      const stepStart = Date.now();

      // Log step start to war room
      broadcastToWarRoom(params.incidentId, {
        type: 'RUNBOOK_LOG_CHUNK',
        incidentId: params.incidentId,
        payload: {
          executionId: params.executionId,
          stepId: step.id,
          message: `[${isDryRun ? 'DRY-RUN' : 'EXEC'}] Starting step: ${step.name}`,
        },
        timestamp: new Date().toISOString(),
      });

      const stepOutcome = await this.executeStep(step, validatedParams, isDryRun);
      stepOutcome.durationMs = Date.now() - stepStart;
      stepResults.push(stepOutcome);

      // Stream output to war room
      broadcastToWarRoom(params.incidentId, {
        type: 'RUNBOOK_LOG_CHUNK',
        incidentId: params.incidentId,
        payload: {
          executionId: params.executionId,
          stepId: step.id,
          message: `[${stepOutcome.status}] ${stepOutcome.output}`,
        },
        timestamp: new Date().toISOString(),
      });

      if (stepOutcome.status === 'FAILED') {
        overallSuccess = false;
        if (step.on_failure === 'abort') {
          logger.warn(
            { executionId: params.executionId, stepId: step.id },
            'Aborting runbook execution due to step failure'
          );
          break;
        }
      }
    }

    const report: RunbookExecutionReport = {
      executionId: params.executionId,
      runbookId: params.runbook.metadata.id,
      status: overallSuccess ? 'COMPLETED' : 'FAILED',
      isDryRun,
      totalDurationMs: Date.now() - startTime,
      steps: stepResults,
    };

    logger.info(
      { executionId: params.executionId, status: report.status, duration: report.totalDurationMs },
      'Runbook execution finished'
    );

    return report;
  }

  private async executeStep(
    step: RunbookStep,
    params: Record<string, string | number | boolean>,
    isDryRun: boolean
  ): Promise<StepExecutionResult> {
    const interpolatedUrl = this.interpolate(step.config.url, params);

    if (isDryRun) {
      return {
        stepId: step.id,
        stepName: step.name,
        status: 'SUCCESS',
        durationMs: 0,
        output: `[SIMULATION] Would perform ${step.config.method} ${interpolatedUrl}`,
      };
    }

    try {
      const response = await fetch(interpolatedUrl, {
        method: step.config.method,
        headers: {
          'Content-Type': 'application/json',
          ...step.config.headers,
        },
        body:
          step.config.body && step.config.method !== 'GET'
            ? typeof step.config.body === 'string'
              ? this.interpolate(step.config.body, params)
              : JSON.stringify(step.config.body)
            : undefined,
        signal: AbortSignal.timeout(step.config.timeout_seconds * 1000),
      });

      const responseText = await response.text();

      // Check assertion
      if (step.assert?.status_code && response.status !== step.assert.status_code) {
        return {
          stepId: step.id,
          stepName: step.name,
          status: 'FAILED',
          durationMs: 0,
          output: `Assertion failed: expected HTTP ${step.assert.status_code}, got ${response.status}. Body: ${responseText.slice(0, 200)}`,
          error: `HTTP Status Mismatch`,
        };
      }

      return {
        stepId: step.id,
        stepName: step.name,
        status: 'SUCCESS',
        durationMs: 0,
        output: `HTTP ${response.status} OK - ${responseText.slice(0, 200)}`,
      };
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Execution error';
      return {
        stepId: step.id,
        stepName: step.name,
        status: 'FAILED',
        durationMs: 0,
        output: `Failed to execute step: ${errorMsg}`,
        error: errorMsg,
      };
    }
  }
}
