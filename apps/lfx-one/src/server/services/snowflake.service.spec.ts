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

import { SNOWFLAKE_CONFIG } from '@lfx-one/shared/constants';
import { SnowflakeCircuitState } from '@lfx-one/shared/enums';

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

  const serviceWithPool = (use: ReturnType<typeof vi.fn>) => {
    vi.mocked(tracer.startActiveSpan).mockImplementation(((_name: string, _options: unknown, fn: (s: typeof span) => unknown) => fn(span)) as never);
    const service = SnowflakeService.getInstance();
    const internals = service as unknown as { pool: unknown; circuitState: SnowflakeCircuitState; lastFailureTime: number };
    internals.pool = { use, borrowed: 20, available: 0, pending: 10, size: 20 };
    return { service, internals };
  };

  const runQueries = async (service: SnowflakeService, count: number) => {
    for (let i = 0; i < count; i++) {
      await service.execute(`SELECT ${i}`).catch(() => undefined);
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
});
