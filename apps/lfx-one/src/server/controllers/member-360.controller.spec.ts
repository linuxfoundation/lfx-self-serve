// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionOwnerToken } from '../utils/mktg-session-token.util';
import { Member360Controller } from './member-360.controller';

const mocks = vi.hoisted(() => ({ start: vi.fn(), result: vi.fn(), preflight: vi.fn(), track: vi.fn(), record: vi.fn() }));
vi.mock('../services/mktg-document-run.service', () => ({
  MktgDocumentRunService: class {
    public resolveProject = mocks.preflight;
    public startForOneOff = mocks.track;
    public recordResultBestEffort = mocks.record;
  },
}));
vi.mock('../services/member-360.service', async (original) => {
  const actual = await original<typeof import('../services/member-360.service')>();
  return {
    Member360Service: class {
      public static toRunResult = actual.Member360Service.toRunResult;
      public start = mocks.start;
      public result = mocks.result;
    },
  };
});
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: () => 'synthetic-subject' }));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: () => 0, success: vi.fn() } }));

describe('Member 360 HTTP boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.preflight.mockResolvedValue('sample-project');
    mocks.track.mockResolvedValue('a'.repeat(64));
  });
  it.each(['project_name', 'project_uid', 'prior_run', 'request', 'handle'])('rejects client-controlled %s', async (key) => {
    const next = vi.fn();
    await new Member360Controller().generate({ body: { project: 'sample-project', [key]: 'spoof' } } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('returns the document id supplied by the service without a second derivation', async () => {
    mocks.start.mockResolvedValue({ sessionId: 'session-1', documentId: 'run-0123456789abcdef01234567' });
    const res = { json: vi.fn() };
    const next = vi.fn();
    await new Member360Controller().generate({ body: { project: 'sample-project' } } as Request, res as unknown as Response, next);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', documentId: 'run-0123456789abcdef01234567' }));
    expect(mocks.start).toHaveBeenCalledWith(expect.anything(), { project: 'sample-project' });
    expect(next).not.toHaveBeenCalled();
  });
  it('preflights storage before creating a session and requires a durable start before returning success', async () => {
    const failure = Object.assign(new Error('Tracking unavailable'), { statusCode: 503 });
    const next = vi.fn();
    const json = vi.fn();
    mocks.preflight.mockRejectedValueOnce(failure);
    await new Member360Controller().generate({ body: { project: 'sample-project' } } as Request, { json } as unknown as Response, next);
    expect(next).toHaveBeenLastCalledWith(failure);
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.start.mockResolvedValue({ sessionId: 'session-1', documentId: 'run-0123456789abcdef01234567' });
    mocks.track.mockRejectedValueOnce(failure);
    await new Member360Controller().generate({ body: { project: 'sample-project' } } as Request, { json } as unknown as Response, next);
    expect(next).toHaveBeenLastCalledWith(failure);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.track).toHaveBeenCalledWith(expect.anything(), 'member-360', 'sample-project', 'session-1');
  });
  it('does not accept an ordinary chat token or another project token', async () => {
    for (const scope of ['session-1', 'member-360:other-project:session-1']) {
      const next = vi.fn();
      await new Member360Controller().result(
        { body: { sessionId: 'session-1', project: 'sample-project', ownerToken: createSessionOwnerToken('synthetic-subject', scope) } } as Request,
        {} as Response,
        next
      );
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    }
    expect(mocks.result).not.toHaveBeenCalled();
  });
  it('returns the creator/project/agent-bound result as-is without the settled-error overlay', async () => {
    const json = vi.fn();
    const next = vi.fn();
    const pending = { status: 'pending', activity: [] };
    mocks.result.mockResolvedValue(pending);
    await new Member360Controller().result(
      {
        body: {
          sessionId: 'session-1',
          project: 'sample-project',
          ownerToken: createSessionOwnerToken('synthetic-subject', 'member-360:sample-project:session-1'),
        },
      } as Request,
      { json } as unknown as Response,
      next
    );
    expect(json.mock.calls[0]?.[0]).toBe(pending);
    expect(mocks.result).toHaveBeenCalledWith(expect.anything(), 'session-1', 'sample-project');
    expect(next).not.toHaveBeenCalled();
  });
});
