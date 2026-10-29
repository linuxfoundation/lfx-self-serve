// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionOwnerToken } from '../utils/mktg-session-token.util';
import { Member360Controller } from './member-360.controller';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  result: vi.fn(),
  preflight: vi.fn(),
  track: vi.fn(),
  record: vi.fn(),
  active: vi.fn(),
  prepare: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock('../services/mktg-document-run.service', () => ({
  MktgDocumentRunService: class {
    public resolveProject = mocks.preflight;
    public assertSingleActiveOneOffRun = mocks.active;
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
      public prepareTrackers = mocks.prepare;
      public deleteConsumedTrackers = mocks.cleanup;
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
    mocks.prepare.mockResolvedValue([]);
  });
  it('refuses before creating a Guild session and passes explicit discard separately from the agent intake', async () => {
    const conflict = Object.assign(new Error('Active run'), { statusCode: 409, code: 'MKTG_RUN_ACTIVE' });
    const req = { body: { project: 'sample-project', discard: 'a'.repeat(64) } } as Request;
    const res = { json: vi.fn() } as unknown as Response;
    const next = vi.fn();
    mocks.active.mockRejectedValueOnce(conflict);
    await new Member360Controller().generate(req, res, next);
    expect(next).toHaveBeenCalledWith(conflict);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.active).toHaveBeenCalledWith(req, 'sample-project', 'member-360', 'a'.repeat(64));
    mocks.start.mockResolvedValue({ sessionId: 'session-1', documentId: 'run-0123456789abcdef01234567' });
    await new Member360Controller().generate(req, res, vi.fn());
    expect(mocks.start).toHaveBeenCalledWith(req, { project: 'sample-project' }, []);
  });
  it('rejects expired trackers before discarding the active run or starting a replacement', async () => {
    const failure = Object.assign(new Error('Upload the tracker again.'), { statusCode: 400 });
    mocks.prepare.mockRejectedValue(failure);
    const next = vi.fn();
    await new Member360Controller().generate(
      { body: { project: 'sample-project', trackerIds: ['a'.repeat(64)], discard: 'b'.repeat(64) } } as Request,
      {} as Response,
      next
    );
    expect(next).toHaveBeenCalledWith(failure);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });
  it('reuses validated private rows only after the active-run guard succeeds', async () => {
    const rows = [{ filename: 'tracker.csv', rows: [{ company: 'Synthetic Member' }] }];
    mocks.prepare.mockResolvedValue(rows);
    mocks.start.mockResolvedValue({ sessionId: 'session-1', documentId: 'run-0123456789abcdef01234567' });
    const req = { body: { project: 'sample-project', trackerIds: ['a'.repeat(64)], discard: 'b'.repeat(64) } } as Request;
    await new Member360Controller().generate(req, { json: vi.fn() } as unknown as Response, vi.fn());
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.active.mock.invocationCallOrder[0]);
    expect(mocks.active.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[0]);
    expect(mocks.start).toHaveBeenCalledWith(req, { project: 'sample-project', trackerIds: ['a'.repeat(64)] }, rows);
    expect(mocks.cleanup).toHaveBeenCalledWith(req, 'sample-project', ['a'.repeat(64)]);
    expect(mocks.track.mock.invocationCallOrder[0]).toBeLessThan(mocks.cleanup.mock.invocationCallOrder[0]);
  });
  it('retains prepared private rows when durable registration fails so receipts remain usable', async () => {
    const rows = [{ filename: 'tracker.csv', rows: [{ company: 'Synthetic Member' }] }];
    let retained = true;
    mocks.prepare.mockImplementation(async () => (retained ? rows : []));
    mocks.cleanup.mockImplementation(async () => {
      retained = false;
    });
    mocks.start.mockResolvedValue({ sessionId: 'session-1', documentId: 'run-0123456789abcdef01234567' });
    const failure = new Error('Synthetic registration unavailable');
    mocks.track.mockRejectedValueOnce(failure);
    const next = vi.fn();
    const input = { project: 'sample-project', trackerIds: ['a'.repeat(64)] };
    await new Member360Controller().generate({ body: input } as Request, { json: vi.fn() } as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(failure);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(retained).toBe(true);
    expect(await mocks.prepare({} as Request, input)).toEqual(rows);
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
    expect(mocks.start).toHaveBeenCalledWith(expect.anything(), { project: 'sample-project' }, []);
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
