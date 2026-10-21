// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MKTG_AGENTS } from '@lfx-one/shared/constants';
vi.mock('@lfx-one/shared/constants', async (original) => {
  const actual = await original<typeof import('@lfx-one/shared/constants')>();
  return {
    ...actual,
    MKTG_AGENTS: actual.MKTG_AGENTS.map((agent) => (agent.id === 'linkedin-post' ? { ...agent, status: 'active', guildAgentHandle: 'linkedin-post' } : agent)),
  };
});
import { createSessionOwnerToken } from '../utils/mktg-session-token.util';
const mocks = vi.hoisted(() => ({
  share: vi.fn(),
  answer: vi.fn(),
  start: vi.fn(),
  result: vi.fn(),
  read: vi.fn(),
  saveFromInput: vi.fn(),
  delete: vi.fn(),
  project: vi.fn(),
  startOperation: vi.fn(() => 0),
}));
vi.mock('../services/mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public saveLinkedinShareLink = mocks.share;
  },
}));
vi.mock('../services/linkedin-post.service', () => ({
  LinkedinPostService: class {
    public start = mocks.start;
    public result = mocks.result;
    public sendAnswers = mocks.answer;
  },
}));
vi.mock('../services/linkedin-profile.service', () => ({
  LinkedinProfileService: class {
    public read = mocks.read;
    public saveFromInput = mocks.saveFromInput;
    public delete = mocks.delete;
  },
}));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = mocks.project;
  },
}));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: mocks.startOperation, success: vi.fn() } }));
import { LinkedinPostController } from './linkedin-post.controller';

function request(body: unknown, sub = 'subject-one', username = 'initial-user'): Request {
  return Object.assign({} as Request, { method: 'POST', body, oidc: { user: { sub, 'https://sso.linuxfoundation.org/claims/username': username } } });
}
function response(): Response {
  const res = { json: vi.fn(), set: vi.fn(), status: vi.fn(), end: vi.fn() };
  res.set.mockReturnValue(res);
  res.status.mockReturnValue(res);
  return Object.assign({} as Response, res);
}
describe('LinkedIn endpoint boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockResolvedValue({ uid: 'project-one', writer: true });
    mocks.start.mockResolvedValue({ sessionId: 'session-one', documentId: 'run-0123456789abcdef01234567' });
    mocks.result.mockResolvedValue({ status: 'pending' });
  });
  it('binds gap answers to the owner and writer grant, validates ids, and continues the same session', async () => {
    const body = {
      sessionId: 'session-one',
      ownerToken: createSessionOwnerToken('subject-one', 'session-one'),
      project: 'project-one',
      questionsId: 'a'.repeat(64),
      answers: [{ key: 'tendency', text: 'Direct and practical, with a friendly tone.', origin: 'accepted' }],
    };
    const controller = new LinkedinPostController();
    const next = vi.fn();
    const res = response();
    await controller.answer(request(body), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.answer).toHaveBeenCalledWith(expect.anything(), 'session-one', body.questionsId, body.answers, 'linkedin-post');
    expect(res.json).toHaveBeenCalledWith({ success: true });
    mocks.answer.mockClear();
    await controller.answer(request({ ...body, ownerToken: 'forged' }), res, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403 }));
    await controller.answer(request({ ...body, answers: [{ key: 'name', text: 'Invalid identity gap', origin: 'requester' }] }), res, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 400 }));
    mocks.project.mockResolvedValue({ uid: 'project-one', writer: false });
    await controller.answer(request(body), res, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('checks writer entitlement and validates share-link edits before the metadata store', async () => {
    const controller = new LinkedinPostController();
    const req = request({ project: 'project-one', share_link: 'https://public.example/changed' });
    req.params = { documentId: 'run-0123456789abcdef01234567' };
    mocks.share.mockResolvedValue({ share_link: 'https://public.example/changed' });
    const next = vi.fn();
    const res = response();
    await controller.saveShareLink(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.share).toHaveBeenCalledWith(req, 'project-one', req.params['documentId'], 'https://public.example/changed');
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.share.mockClear();
    mocks.project.mockResolvedValue({ uid: 'project-one', writer: false });
    await controller.saveShareLink(req, res, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mocks.share).not.toHaveBeenCalled();
    for (const value of ['http://public.example/', 'javascript:bad', 'x'.repeat(2049)]) {
      req.body = { project: 'project-one', share_link: value };
      await controller.saveShareLink(req, res, next);
      expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 400 }));
    }
  });

  it('rejects anonymous, malformed and out-of-scope requests before starting a run', async () => {
    const controller = new LinkedinPostController();
    for (const body of [
      null,
      [],
      { answers: {} },
      { project: '../bad', answers: {} },
      { project: 'project-one', answers: {}, feedback: 'forbidden' },
      { project: 'project-one', answers: { today: 'forged' } },
    ]) {
      const next = vi.fn();
      await controller.generate(request(body), response(), next);
      expect(next).toHaveBeenCalled();
    }
    const next = vi.fn();
    await controller.generate(request({}, ''), response(), next);
    expect(next).toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('requires writer entitlement before source fetch or session creation', async () => {
    mocks.project.mockResolvedValue({ uid: 'project-one', writer: false });
    const next = vi.fn();
    await new LinkedinPostController().generate(
      request({ project: 'project-one', answers: { content_source: 'text', content_text: 'Source' } }),
      response(),
      next
    );
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('takes the handle from the catalog and mints a user-bound owner token', async () => {
    const controller = new LinkedinPostController();
    const res = response();
    const next = vi.fn();
    await controller.generate(request({ project: 'project-one', answers: { content_source: 'text', content_text: 'Source' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    const agent = MKTG_AGENTS.find((a) => a.id === 'linkedin-post');
    expect(agent?.status).toBe('active');
    expect(mocks.start).toHaveBeenCalledWith(expect.anything(), 'subject-one', expect.anything(), undefined, 'linkedin-post');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ownerToken: createSessionOwnerToken('subject-one', 'session-one') }));
  });

  it('refuses another user’s token before reading events or saving profiles', async () => {
    const next = vi.fn();
    await new LinkedinPostController().result(
      request({ project: 'project-one', sessionId: 'session-one', ownerToken: createSessionOwnerToken('someone-else', 'session-one') }),
      response(),
      next
    );
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(mocks.result).not.toHaveBeenCalled();
  });

  it('keeps the product-owner stable-sub profile identity across account username changes', async () => {
    mocks.read.mockResolvedValue(null);
    const controller = new LinkedinPostController();
    await controller.getProfile(request({}, 'stable-subject', 'initial-user'), response(), vi.fn());
    await controller.getProfile(request({}, 'stable-subject', 'renamed-user'), response(), vi.fn());
    expect(mocks.read.mock.calls.map((call) => call[1])).toEqual(['stable-subject', 'stable-subject']);
  });
});
