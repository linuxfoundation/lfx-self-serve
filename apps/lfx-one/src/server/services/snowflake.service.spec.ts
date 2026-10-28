// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SnowflakeQueryOptions } from '@lfx-one/shared/interfaces';

vi.mock('snowflake-sdk', () => ({
  default: {
    configure: vi.fn(),
    createPool: vi.fn(),
  },
}));

vi.mock('../server-tracer', () => ({
  tracer: {
    startActiveSpan: vi.fn(),
  },
}));

vi.mock('./logger.service', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

import { SNOWFLAKE_CONFIG, SNOWFLAKE_QUERY_ERROR_CLIENT_MESSAGE } from '@lfx-one/shared/constants';
import { SnowflakeCircuitState } from '@lfx-one/shared/enums';
import snowflakeSdk from 'snowflake-sdk';

import { MicroserviceError } from '../errors';
import { tracer } from '../server-tracer';
import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';

describe('SnowflakeService query deduplication', () => {
  afterEach(() => {
    SnowflakeService.resetInstance();
  });

  it('forwards execution options into the LockManager query hash', async () => {
    const service = SnowflakeService.getInstance();
    const lockManager = {
      executeLocked: vi.fn().mockResolvedValue({ rows: [], metadata: [] }),
      hashQuery: vi.fn(() => 'query-hash'),
      shutdown: vi.fn(),
    };
    const serviceInternals = service as unknown as {
      lockManager: typeof lockManager;
    };
    serviceInternals.lockManager.shutdown();
    serviceInternals.lockManager = lockManager;

    const options: SnowflakeQueryOptions = {
      timeout: 1_000,
      fetchAsString: ['Number'],
      expectMissingObject: true,
      expectInvalidIdentifier: 'LAST_TOUCH_CONVERSIONS',
    };

    await service.execute('SELECT 1', [], options);

    expect(lockManager.hashQuery).toHaveBeenCalledWith('SELECT 1', [], options);
  });
});

describe('SnowflakeService circuit breaker', () => {
  const span = { setStatus: vi.fn(), setAttribute: vi.fn(), recordException: vi.fn(), end: vi.fn() };
  const poolQueueFull = () => Promise.reject(new Error('max waitingClients count exceeded'));
  const queryFailure = () => Promise.reject(new Error('Network error. Could not reach Snowflake.'));
  const querySuccess = () => Promise.resolve({ rows: [], metadata: [] });
  const invalidRowCount = () =>
    Promise.reject(
      Object.assign(new Error("SQL compilation error:\nInvalid row count '10000000000000000000000000' in result offset clause"), { code: '002011' })
    );
  const valueConversion = () => Promise.reject(Object.assign(new Error("Date 'x' is not recognized"), { code: '100040' }));
  const missingObject = () => Promise.reject(new Error("SQL compilation error: Object 'ANALYTICS.PLATINUM_LFX_ONE.EXAMPLE' does not exist or not authorized."));
  const missingNamedObject = (object: string) => () => Promise.reject(new Error(`SQL compilation error: Object '${object}' does not exist or not authorized.`));
  const OPTIONAL_TABLE = 'ORG_PEOPLE_COMPANY_EMAILS';

  const serviceWithPool = (use: ReturnType<typeof vi.fn>) => {
    vi.mocked(tracer.startActiveSpan).mockImplementation(((_name: string, _options: unknown, fn: (s: typeof span) => unknown) => fn(span)) as never);
    const service = SnowflakeService.getInstance();
    const internals = service as unknown as { pool: unknown; circuitState: SnowflakeCircuitState; lastFailureTime: number };
    internals.pool = { use, borrowed: 20, available: 0, pending: 10, size: 20 };
    return { service, internals };
  };

  const runQueries = async (service: SnowflakeService, count: number, options?: SnowflakeQueryOptions) => {
    for (let i = 0; i < count; i++) {
      await service.execute(`SELECT ${i}`, [], options).catch(() => undefined);
    }
  };

  afterEach(() => {
    SnowflakeService.resetInstance();
    vi.clearAllMocks();
  });

  it('keeps the circuit closed when the local pool rejects queries because its waiting queue is full', async () => {
    const { service } = serviceWithPool(vi.fn(poolQueueFull));

    await expect(service.execute('SELECT 1')).rejects.toMatchObject({ code: 'SNOWFLAKE_QUERY_ERROR' });
    await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD * 2);

    expect(service.getCircuitStats()).toMatchObject({ state: SnowflakeCircuitState.CLOSED, consecutiveFailures: 0 });
    expect(span.setAttribute).toHaveBeenCalledWith('snowflake.pool_queue_full', true);
  });

  it('carries pool stats on the thrown error instead of logging the queue rejection in the service', async () => {
    const { service } = serviceWithPool(vi.fn(poolQueueFull));

    await expect(service.execute('SELECT 1')).rejects.toMatchObject({
      statusCode: 500,
      code: 'SNOWFLAKE_QUERY_ERROR',
      errorBody: { pool_queue_full: true, pool: { activeConnections: 20, waitingRequests: 10 } },
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warning).not.toHaveBeenCalled();
    expect(span.recordException).not.toHaveBeenCalled();
  });

  it('still opens the circuit after repeated genuine Snowflake failures', async () => {
    const { service } = serviceWithPool(vi.fn(queryFailure));

    await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD);

    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.OPEN);
  });

  it('frees the HALF_OPEN probe slot when the probe is rejected by a full pool queue', async () => {
    const use = vi.fn().mockImplementationOnce(poolQueueFull).mockImplementation(querySuccess);
    const { service, internals } = serviceWithPool(use);
    internals.circuitState = SnowflakeCircuitState.OPEN;
    internals.lastFailureTime = Date.now() - SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - 1;

    await expect(service.execute('SELECT 1')).rejects.toMatchObject({ code: 'SNOWFLAKE_QUERY_ERROR' });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.HALF_OPEN);

    await expect(service.execute('SELECT 2')).resolves.toEqual({ rows: [], metadata: [] });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.CLOSED);
  });

  it('keeps the circuit closed when Snowflake rejects an out-of-range LIMIT/OFFSET', async () => {
    const { service } = serviceWithPool(vi.fn(invalidRowCount));

    await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD * 2);

    expect(service.getCircuitStats()).toMatchObject({ state: SnowflakeCircuitState.CLOSED, consecutiveFailures: 0 });
    expect(span.setAttribute).toHaveBeenCalledWith('snowflake.invalid_row_count', true);
  });

  it('still opens the circuit after repeated missing-object errors, which can mean a revoked GRANT', async () => {
    const { service } = serviceWithPool(vi.fn(missingObject));

    await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD);

    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.OPEN);
  });

  it('frees the HALF_OPEN probe slot when the probe is rejected for an out-of-range row count', async () => {
    const use = vi.fn().mockImplementationOnce(invalidRowCount).mockImplementation(querySuccess);
    const { service, internals } = serviceWithPool(use);
    internals.circuitState = SnowflakeCircuitState.OPEN;
    internals.lastFailureTime = Date.now() - SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - 1;

    await expect(service.execute('SELECT 1')).rejects.toMatchObject({ code: 'SNOWFLAKE_QUERY_ERROR' });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.HALF_OPEN);

    await expect(service.execute('SELECT 2')).resolves.toEqual({ rows: [], metadata: [] });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.CLOSED);
  });

  it('keeps the circuit closed when Snowflake cannot convert a bind value', async () => {
    const { service } = serviceWithPool(vi.fn(valueConversion));

    await expect(service.execute('SELECT CURRENT_DATE >= ?', ['x'])).rejects.toMatchObject({ statusCode: 500, code: 'SNOWFLAKE_QUERY_ERROR' });
    await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD * 2);

    expect(service.getCircuitStats()).toMatchObject({ state: SnowflakeCircuitState.CLOSED, consecutiveFailures: 0 });
    expect(span.setAttribute).toHaveBeenCalledWith('snowflake.value_conversion', true);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not reset or increment genuine failures when a bind conversion fails', async () => {
    const use = vi.fn().mockImplementationOnce(queryFailure).mockImplementation(valueConversion);
    const { service } = serviceWithPool(use);

    await expect(service.execute('SELECT 1')).rejects.toMatchObject({ code: 'SNOWFLAKE_QUERY_ERROR' });
    await expect(service.execute('SELECT CURRENT_DATE >= ?', ['x'])).rejects.toMatchObject({ statusCode: 500, code: 'SNOWFLAKE_QUERY_ERROR' });

    expect(service.getCircuitStats()).toMatchObject({ state: SnowflakeCircuitState.CLOSED, consecutiveFailures: 1 });
  });

  it('frees the HALF_OPEN probe slot when the probe fails a bind conversion', async () => {
    const use = vi.fn().mockImplementationOnce(valueConversion).mockImplementation(querySuccess);
    const { service, internals } = serviceWithPool(use);
    internals.circuitState = SnowflakeCircuitState.OPEN;
    internals.lastFailureTime = Date.now() - SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - 1;

    await expect(service.execute('SELECT CURRENT_DATE >= ?', ['x'])).rejects.toMatchObject({ statusCode: 500, code: 'SNOWFLAKE_QUERY_ERROR' });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.HALF_OPEN);

    await expect(service.execute('SELECT 2')).resolves.toEqual({ rows: [], metadata: [] });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.CLOSED);
  });

  it('rejects an oversized bind list with a 400 before reaching Snowflake or the circuit breaker', async () => {
    const use = vi.fn(querySuccess);
    const { service } = serviceWithPool(use);
    const binds = Array.from({ length: SNOWFLAKE_CONFIG.MAX_BIND_VARIABLES + 1 }, (_, i) => `value-${i}`);

    for (let i = 0; i < SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD * 2; i++) {
      await expect(service.execute(`SELECT ${i}`, binds)).rejects.toMatchObject({ statusCode: 400, code: 'SNOWFLAKE_TOO_MANY_BINDS' });
    }

    expect(use).not.toHaveBeenCalled();
    expect(service.getCircuitStats()).toMatchObject({ state: SnowflakeCircuitState.CLOSED, consecutiveFailures: 0 });
  });

  it('accepts a bind list at the cap', async () => {
    const use = vi.fn(querySuccess);
    const { service } = serviceWithPool(use);
    const binds = Array.from({ length: SNOWFLAKE_CONFIG.MAX_BIND_VARIABLES }, (_, i) => `value-${i}`);

    await expect(service.execute('SELECT 1', binds)).resolves.toEqual({ rows: [], metadata: [] });
    expect(use).toHaveBeenCalledTimes(1);
  });

  it('leaves the HALF_OPEN probe slot free when an oversized bind list is rejected', async () => {
    const use = vi.fn(querySuccess);
    const { service, internals } = serviceWithPool(use);
    internals.circuitState = SnowflakeCircuitState.OPEN;
    internals.lastFailureTime = Date.now() - SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - 1;
    const binds = Array.from({ length: SNOWFLAKE_CONFIG.MAX_BIND_VARIABLES + 1 }, (_, i) => `value-${i}`);

    await expect(service.execute('SELECT 1', binds)).rejects.toMatchObject({ code: 'SNOWFLAKE_TOO_MANY_BINDS' });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.OPEN);

    await expect(service.execute('SELECT 2')).resolves.toEqual({ rows: [], metadata: [] });
    expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.CLOSED);
  });

  it('serves the generic client message and no Snowflake text in the full response body', async () => {
    const { service } = serviceWithPool(vi.fn(missingObject));

    const thrown = await service.execute('SELECT 1').catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(MicroserviceError);
    const response = (thrown as MicroserviceError).toResponse();
    expect(response['error']).toBe(SNOWFLAKE_QUERY_ERROR_CLIENT_MESSAGE);
    for (const key of ['originalMessage', 'details', 'errors', 'upstreamCode']) {
      expect(response).not.toHaveProperty(key);
    }
    const body = JSON.stringify(response);
    expect(body).not.toContain('ANALYTICS.PLATINUM_LFX_ONE');
    expect(body).not.toContain('does not exist');
    expect(body).not.toContain('compilation');
  });

  it('keeps the SDK text on the error message so missing-object fallbacks still match', async () => {
    const { service } = serviceWithPool(vi.fn(missingObject));

    const thrown = await service.execute('SELECT 1').catch((error: unknown) => error);

    expect(SnowflakeService.isMissingObjectError(thrown)).toBe(true);
  });

  // The exemption is what keeps an optional table's absence from opening the POD-WIDE breaker. The
  // boundary has to hold in both directions, and only `execute` can show that: the matcher spec
  // proves what the predicate answers, not what the breaker then does with it.
  describe('named missing-object exemption', () => {
    it('keeps the circuit closed while the NAMED object is the missing one', async () => {
      const { service } = serviceWithPool(vi.fn(missingNamedObject(`ANALYTICS.PLATINUM_LFX_ONE.${OPTIONAL_TABLE}`)));

      await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD * 2, { expectMissingObject: OPTIONAL_TABLE });

      expect(service.getCircuitStats()).toMatchObject({ state: SnowflakeCircuitState.CLOSED, consecutiveFailures: 0 });
      expect(span.setAttribute).toHaveBeenCalledWith('snowflake.expected_missing_object', OPTIONAL_TABLE);
    });

    it('still opens the circuit when a DIFFERENT, core object is the missing one', async () => {
      const { service } = serviceWithPool(vi.fn(missingNamedObject('ANALYTICS.SILVER_FACT.EVENT_REGISTRATIONS')));

      await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD, { expectMissingObject: OPTIONAL_TABLE });

      expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.OPEN);
      expect(span.setAttribute).not.toHaveBeenCalledWith('snowflake.expected_missing_object', expect.anything());
    });

    // A core table going missing must not have its breaker failures wiped out by the scoped retry
    // that follows it — the exposure that made the bare boolean wrong.
    it('does not reset failures accumulated from a core outage', async () => {
      const use = vi.fn().mockImplementationOnce(queryFailure).mockImplementationOnce(missingNamedObject('ANALYTICS.SILVER_FACT.EVENT_REGISTRATIONS'));
      const { service } = serviceWithPool(use);

      await service.execute('SELECT 1').catch(() => undefined);
      await service.execute('SELECT 2', [], { expectMissingObject: OPTIONAL_TABLE }).catch(() => undefined);

      expect(service.getCircuitStats().consecutiveFailures).toBe(2);
    });

    // Every other caller still passes `true`, so the broad exemption has to keep working as it did.
    it('still exempts any missing object when the caller passes true', async () => {
      const { service } = serviceWithPool(vi.fn(missingNamedObject('ANALYTICS.SILVER_FACT.EVENT_REGISTRATIONS')));

      await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD * 2, { expectMissingObject: true });

      expect(service.getCircuitStats()).toMatchObject({ state: SnowflakeCircuitState.CLOSED, consecutiveFailures: 0 });
      expect(span.setAttribute).toHaveBeenCalledWith('snowflake.expected_missing_object', true);
    });

    /**
     * The exempt branch must RELEASE the probe, not record a success. Naming the object is not
     * enough on its own: when the address table and a core table are both gone, Snowflake blames the
     * exempt one on the scoped statement, so the exemption fires on every uncached request. If that
     * reset the shared count, the unscoped retry's single genuine failure would be all that ever
     * accumulated and the breaker could never reach its threshold through a real outage.
     */
    it('does not let an alternating expected/genuine sequence hold the breaker closed', async () => {
      const use = vi.fn();
      for (let i = 0; i < SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        use.mockImplementationOnce(missingNamedObject(`ANALYTICS.PLATINUM_LFX_ONE.${OPTIONAL_TABLE}`)).mockImplementationOnce(queryFailure);
      }
      const { service } = serviceWithPool(use);

      for (let i = 0; i < SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD; i++) {
        await service.execute('SELECT scoped', [], { expectMissingObject: OPTIONAL_TABLE }).catch(() => undefined);
        await service.execute('SELECT unscoped').catch(() => undefined);
      }

      expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.OPEN);
    });

    /**
     * HALF_OPEN is the only state `releaseProbe` has any effect in — `probeInFlight` is set by
     * `checkCircuit` and nowhere else — so the CLOSED-state tests above would all still pass if the
     * call were deleted outright. Without it a probe that hits the exempt object leaves
     * `probeInFlight` stuck true, and `checkCircuit` then 503s every Snowflake query on the pod until
     * the process restarts. Mirrors the pool-queue and row-count probe tests.
     *
     * Note what this does NOT assert: that the expected miss closes the circuit. It used to, under
     * `recordSuccess`. A query that never reached a table proves nothing about recovery, so the
     * circuit stays HALF_OPEN and waits for a real success — which is what the second call here is.
     */
    it('frees the HALF_OPEN probe slot when the probe hits the NAMED missing object', async () => {
      const use = vi
        .fn()
        .mockImplementationOnce(missingNamedObject(`ANALYTICS.PLATINUM_LFX_ONE.${OPTIONAL_TABLE}`))
        .mockImplementation(querySuccess);
      const { service, internals } = serviceWithPool(use);
      internals.circuitState = SnowflakeCircuitState.OPEN;
      internals.lastFailureTime = Date.now() - SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_RESET_TIMEOUT_MS - 1;

      await expect(service.execute('SELECT 1', [], { expectMissingObject: OPTIONAL_TABLE })).rejects.toMatchObject({ code: 'SNOWFLAKE_QUERY_ERROR' });
      expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.HALF_OPEN);

      // The slot is free, so this one is admitted rather than fast-failed — and it is a real success,
      // so it is what closes the circuit.
      await expect(service.execute('SELECT 2')).resolves.toEqual({ rows: [], metadata: [] });
      expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.CLOSED);
    });

    it('does not exempt an unrelated failure just because an object was named', async () => {
      const { service } = serviceWithPool(vi.fn(queryFailure));

      await runQueries(service, SNOWFLAKE_CONFIG.CIRCUIT_BREAKER_FAILURE_THRESHOLD, { expectMissingObject: OPTIONAL_TABLE });

      expect(service.getCircuitStats().state).toBe(SnowflakeCircuitState.OPEN);
    });
  });
});

describe('SnowflakeService pool creation failure', () => {
  const span = { setStatus: vi.fn(), setAttribute: vi.fn(), recordException: vi.fn(), end: vi.fn() };

  afterEach(() => {
    SnowflakeService.resetInstance();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('serves the generic client message and no SDK or account text when the pool cannot be created', async () => {
    for (const name of ['SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_USER', 'SNOWFLAKE_ROLE', 'SNOWFLAKE_DATABASE', 'SNOWFLAKE_WAREHOUSE', 'SNOWFLAKE_API_KEY']) {
      vi.stubEnv(name, 'test-value');
    }
    vi.mocked(tracer.startActiveSpan).mockImplementation(((_name: string, _options: unknown, fn: (s: typeof span) => unknown) => fn(span)) as never);
    vi.mocked(snowflakeSdk.createPool).mockImplementation(() => {
      throw new Error('Unable to connect: Incorrect username or password. Account acme.snowflakecomputing.com');
    });

    const thrown = await SnowflakeService.getInstance()
      .execute('SELECT 1')
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(MicroserviceError);
    const response = (thrown as MicroserviceError).toResponse();
    expect(response['error']).toBe(SNOWFLAKE_QUERY_ERROR_CLIENT_MESSAGE);
    const body = JSON.stringify(response);
    expect(body).not.toContain('acme.snowflakecomputing.com');
    expect(body).not.toContain('Incorrect username or password');
  });
});
