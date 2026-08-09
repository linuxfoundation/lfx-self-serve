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
