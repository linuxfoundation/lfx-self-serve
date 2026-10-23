// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSessionOwnerToken } from '../utils/mktg-session-token.util';
import { Member360Controller } from './member-360.controller';

const mocks = vi.hoisted(() => ({ start: vi.fn(), result: vi.fn() }));
vi.mock('../services/member-360.service', () => ({
  Member360Service: class {
    start = mocks.start;
    result = mocks.result;
  },
}));
vi.mock('../utils/auth-helper', () => ({ getEffectiveSub: () => 'synthetic-subject' }));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: () => 0, success: vi.fn() } }));

describe('Member 360 HTTP boundary', () => {
  beforeEach(() => vi.resetAllMocks());
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
  it('accepts only the creator/project/agent-bound token', async () => {
    const json = vi.fn();
    const next = vi.fn();
    mocks.result.mockResolvedValue({ status: 'pending' });
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
    expect(json).toHaveBeenCalledWith({ status: 'pending' });
    expect(mocks.result).toHaveBeenCalledWith(expect.anything(), 'session-1', 'sample-project');
    expect(next).not.toHaveBeenCalled();
  });
});
