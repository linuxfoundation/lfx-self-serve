// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPipeline } = vi.hoisted(() => ({ getPipeline: vi.fn() }));

vi.mock('@lfx-one/shared/constants', () => ({
  FORMATION_PIPELINE_SEARCH_MAX_LENGTH: 100,
  FORMATION_PIPELINE_STAGES: ['prospect', 'exploratory', 'engaged', 'on_hold', 'disengaged', 'confidential', 'archived'],
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('../helpers/validation.helper', () => ({
  validateFoundationUidParameter: vi.fn((value: unknown, _req: unknown, next: (error: unknown) => void) => {
    if (value === undefined || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value))) {
      return true;
    }
    next({ name: 'ServiceValidationError' });
    return false;
  }),
}));
vi.mock('../services/formation-pipeline.service', () => ({ formationPipelineService: { getPipeline } }));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getFormationPipeline } from './formation-pipeline.controller';

function buildReq(query: Record<string, unknown> = {}): any {
  return { query, path: '/api/formations/pipeline' };
}

function buildRes(): any {
  return { json: vi.fn(), set: vi.fn() };
}

describe('formation-pipeline.controller — getFormationPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPipeline.mockResolvedValue({ rows: [], counts: { total: 0 } });
  });

  it('defaults to every pipeline stage and sends no-store', async () => {
    const res = buildRes();

    await getFormationPipeline(buildReq(), res, vi.fn());

    expect(getPipeline.mock.calls[0][1].stages).toHaveLength(7);
    expect(getPipeline.mock.calls[0][1].stages).not.toContain('active');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('accepts one stage and a repeated stage', async () => {
    await getFormationPipeline(buildReq({ stage: 'engaged' }), buildRes(), vi.fn());
    await getFormationPipeline(buildReq({ stage: ['prospect', 'archived'] }), buildRes(), vi.fn());

    expect(getPipeline.mock.calls[0][1].stages).toEqual(['engaged']);
    expect(getPipeline.mock.calls[1][1].stages).toEqual(['prospect', 'archived']);
  });

  it.each([{ stage: 'active' }, { stage: ['engaged', 'nope'] }, { stage: { a: '1' } }])('rejects an unknown stage %j', async (query) => {
    const next = vi.fn();

    await getFormationPipeline(buildReq(query), buildRes(), next);

    expect(getPipeline).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ServiceValidationError' }));
  });

  it('rejects a malformed foundation_uid and an over-long or repeated q', async () => {
    for (const query of [{ foundation_uid: 'has a space' }, { q: 'x'.repeat(101) }, { q: ['a', 'b'] }]) {
      const next = vi.fn();
      await getFormationPipeline(buildReq(query), buildRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ServiceValidationError' }));
    }
    expect(getPipeline).not.toHaveBeenCalled();
  });

  it('forwards foundation_uid and a trimmed q', async () => {
    await getFormationPipeline(buildReq({ foundation_uid: 'f-1', q: '  fleet ' }), buildRes(), vi.fn());

    expect(getPipeline.mock.calls[0][1]).toMatchObject({ foundationUid: 'f-1', search: 'fleet' });
  });

  it('passes a service error (e.g. 403) to next()', async () => {
    const failure = new Error('forbidden');
    getPipeline.mockRejectedValue(failure);
    const next = vi.fn();

    await getFormationPipeline(buildReq(), buildRes(), next);

    expect(next).toHaveBeenCalledWith(failure);
  });
});
