// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — defined before any module is imported so vi.mock factories can reference them.
const { getFormationsQueue } = vi.hoisted(() => ({
  getFormationsQueue: vi.fn(),
}));

// The `@lfx-one/shared/*` path alias isn't wired into the server-side vitest config.
vi.mock('@lfx-one/shared/constants', () => ({ FORMATION_QUEUE_SUB_STAGES: ['exploratory', 'engaged', 'on_hold'] }));
vi.mock('@lfx-one/shared/interfaces', () => ({}));

// validation.helper.ts pulls in @lfx-one/shared/utils, which transitively drags in @angular/common
// (JIT-compilation failure under vitest's node environment) — mock it wholesale, same as
// committee.controller.spec.ts, reimplementing only the `foundation_uid` behavior under test.
vi.mock('../helpers/validation.helper', async () => {
  const { ServiceValidationError } = await import('../errors');
  return {
    validateUidParameter: vi.fn(() => true),
    validateItemKeyParameter: vi.fn(() => true),
    validateFoundationUidParameter: vi.fn((value: unknown, req: any, next: any, options: any) => {
      if (value === undefined) {
        return true;
      }
      if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
        next(
          new ServiceValidationError(
            [{ field: 'foundation_uid', message: 'foundation_uid must be a valid project uid', code: 'VALIDATION_ERROR' }],
            'Validation failed',
            { operation: options.operation, path: req.path }
          )
        );
        return false;
      }
      return true;
    }),
  };
});

vi.mock('../services/formation.service', () => ({
  formationService: { getFormationsQueue },
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth: vi.fn() }));

import { getFormationsQueue as getFormationsQueueController } from './formation.controller';

function buildReq(query: Record<string, unknown> = {}): any {
  return { query, path: '/api/formations', log: {} };
}

function buildRes(): any {
  return { json: vi.fn() };
}

describe('formation.controller — getFormationsQueue foundation_uid handling (GH-2367)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFormationsQueue.mockResolvedValue({ rows: [], tiles: {} });
  });

  it('passes undefined when foundation_uid is absent', async () => {
    await getFormationsQueueController(buildReq(), buildRes(), vi.fn());

    expect(getFormationsQueue).toHaveBeenCalledWith(expect.anything(), undefined, undefined, undefined);
  });

  it('forwards a valid foundation_uid to the service', async () => {
    await getFormationsQueueController(buildReq({ foundation_uid: 'aaif-uid-1' }), buildRes(), vi.fn());

    expect(getFormationsQueue).toHaveBeenCalledWith(expect.anything(), undefined, undefined, 'aaif-uid-1');
  });

  it('rejects a malformed foundation_uid via next() instead of silently widening to root scope', async () => {
    const next = vi.fn();

    await getFormationsQueueController(buildReq({ foundation_uid: 'has a space' }), buildRes(), next);

    expect(getFormationsQueue).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ServiceValidationError' }));
  });

  it('rejects a non-string foundation_uid (e.g. a repeated query param) via next()', async () => {
    const next = vi.fn();

    await getFormationsQueueController(buildReq({ foundation_uid: ['a', 'b'] }), buildRes(), next);

    expect(getFormationsQueue).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ServiceValidationError' }));
  });
});
