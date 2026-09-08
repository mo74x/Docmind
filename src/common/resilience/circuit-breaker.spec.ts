import { CircuitBreaker, CircuitBreakerOpenException } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'TestService',
      failureThreshold: 3,
      resetTimeoutMs: 1000,
    });
  });

  it('should start in CLOSED state and execute calls successfully', async () => {
    expect(breaker.getState()).toBe('CLOSED');
    const result = await breaker.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should stay CLOSED if failures are below threshold', async () => {
    await expect(
      breaker.execute(() => Promise.reject(new Error('fail 1'))),
    ).rejects.toThrow('fail 1');
    await expect(
      breaker.execute(() => Promise.reject(new Error('fail 2'))),
    ).rejects.toThrow('fail 2');

    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should transition to OPEN when failureThreshold is reached', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error(`fail ${i + 1}`))),
      ).rejects.toThrow();
    }

    expect(breaker.getState()).toBe('OPEN');

    // Subsequent calls should fail immediately with CircuitBreakerOpenException
    await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow(
      CircuitBreakerOpenException,
    );
  });

  it('should transition to HALF_OPEN after resetTimeout and close on success', async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('OPEN');

    // Advance time beyond resetTimeoutMs
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);

    expect(breaker.getState()).toBe('HALF_OPEN');

    // Successful probe
    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('CLOSED');
  });

  it('should return to OPEN if probe call fails in HALF_OPEN state', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }

    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 1500);
    expect(breaker.getState()).toBe('HALF_OPEN');

    // Failed probe
    await expect(
      breaker.execute(() => Promise.reject(new Error('probe failed'))),
    ).rejects.toThrow('probe failed');
    expect(breaker.getState()).toBe('OPEN');
  });

  it('should allow manual reset', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        breaker.execute(() => Promise.reject(new Error('fail'))),
      ).rejects.toThrow();
    }
    expect(breaker.getState()).toBe('OPEN');

    breaker.reset();
    expect(breaker.getState()).toBe('CLOSED');
  });
});
