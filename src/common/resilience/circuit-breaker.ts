/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Logger, ServiceUnavailableException } from '@nestjs/common';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  name?: string;
  failureThreshold?: number; // consecutive failures before opening
  resetTimeoutMs?: number; // ms to wait before trying half-open
}

export class CircuitBreakerOpenException extends ServiceUnavailableException {
  constructor(serviceName: string) {
    super(
      `Service "${serviceName}" is temporarily unavailable (circuit breaker open). Please try again shortly.`,
    );
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly logger: Logger;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name || 'ExternalService';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.logger = new Logger(`CircuitBreaker:${this.name}`);
  }

  getState(): CircuitState {
    // If open and cool-off period has passed, transition to HALF_OPEN
    if (
      this.state === 'OPEN' &&
      Date.now() - this.lastFailureTime >= this.resetTimeoutMs
    ) {
      this.state = 'HALF_OPEN';
      this.logger.warn(
        `Cool-off period elapsed. Transitioning from OPEN to HALF_OPEN. Probing health...`,
      );
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      this.logger.warn(`Fast-failing call. Circuit is OPEN.`);
      throw new CircuitBreakerOpenException(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.logger.log(
        `Probe request succeeded. Transitioning from HALF_OPEN to CLOSED.`,
      );
    }
    this.state = 'CLOSED';
    this.failureCount = 0;
  }

  private onFailure(error: any): void {
    this.lastFailureTime = Date.now();
    const errorMsg = error?.message || String(error);

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.logger.error(
        `Probe request failed (${errorMsg}). Returning to OPEN state.`,
      );
      return;
    }

    this.failureCount += 1;
    this.logger.warn(
      `Call failed (${this.failureCount}/${this.failureThreshold}): ${errorMsg}`,
    );

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.logger.error(
        `Failure threshold (${this.failureThreshold}) reached. Circuit breaker is now OPEN.`,
      );
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
