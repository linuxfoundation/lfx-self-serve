// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinStoredProfile } from '@lfx-one/shared/interfaces';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils';
import { LINKEDIN_SOURCE_MAX_WORDS, MKTG_AGENTS, MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
vi.mock('@lfx-one/shared/constants', async (original) => {
  const actual = await original<typeof import('@lfx-one/shared/constants')>();
  return {
    ...actual,
    MKTG_AGENTS: actual.MKTG_AGENTS.map((agent) => (agent.id === 'linkedin-post' ? { ...agent, status: 'active', guildAgentHandle: 'linkedin-post' } : agent)),
  };
});
import { createSessionOwnerToken } from '../utils/mktg-session-token.util';
const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  track: vi.fn(),
  record: vi.fn(),
  resume: vi.fn(),
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
vi.mock('../services/mktg-document-run.service', () => ({
  MktgDocumentRunService: class {
    public resolveProject = mocks.preflight;
    public startForOneOff = mocks.track;
    public recordResultBestEffort = mocks.record;
    public resumeAfterQuestions = mocks.resume;
  },
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
    mocks.preflight.mockImplementation(async (req: Request, project: unknown) => {
      if (typeof project !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw Object.assign(new Error('Invalid project'), { statusCode: 400 });
      const resolved = await mocks.project(req, project);
      if (!resolved.writer) throw Object.assign(new Error('No access'), { statusCode: 403 });
      return resolved.uid;
    });
    mocks.track.mockResolvedValue('a'.repeat(64));
    mocks.start.mockResolvedValue({ sessionId: 'session-one', documentId: 'run-0123456789abcdef01234567', source: { words: 12 } });
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
    expect(mocks.resume).toHaveBeenCalledWith(expect.anything(), 'project-one', 'session-one', body.questionsId);
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

  it('preflights storage before Guild and captures private metadata before acknowledging Generate', async () => {
    const req = request({ project: 'project-one', answers: { content_source: 'text', content_text: 'Synthetic source' } });
    const res = response();
    const next = vi.fn();
    const failure = Object.assign(new Error('Tracking unavailable'), { statusCode: 503 });
    mocks.preflight.mockRejectedValueOnce(failure);
    await new LinkedinPostController().generate(req, res, next);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(next).toHaveBeenLastCalledWith(failure);
    await new LinkedinPostController().generate(req, res, next);
    expect(mocks.track).toHaveBeenCalledWith(req, 'linkedin-post', 'project-one', 'session-one', { sourceWords: 12 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ runId: 'a'.repeat(64) }));
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
  it('preserves omitted answers and bounds sourceWords in words, not bytes', async () => {
    const controller = new LinkedinPostController();
    const body = {
      project: 'project-one',
      sessionId: 'session-one',
      ownerToken: createSessionOwnerToken('subject-one', 'session-one'),
      sourceWords: LINKEDIN_SOURCE_MAX_WORDS,
    };
    const next = vi.fn();
    await controller.result(request(body), response(), next);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.result).toHaveBeenCalledWith(expect.anything(), 'subject-one', 'session-one', 'project-one', undefined, LINKEDIN_SOURCE_MAX_WORDS);
    mocks.result.mockClear();
    await controller.result(request({ ...body, sourceWords: LINKEDIN_SOURCE_MAX_WORDS + 1 }), response(), next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.result).not.toHaveBeenCalled();
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
  it('reads profiles using the effective sub, never a caller-supplied identity', async () => {
    const req = request({ user: 'other-user' });
    req.method = 'GET';
    mocks.read.mockResolvedValue(null);
    await new LinkedinPostController().getProfile(req, response(), vi.fn());
    expect(mocks.read).toHaveBeenCalledWith(req, 'subject-one');
    expect(mocks.startOperation).toHaveBeenCalledWith(req, 'get_linkedin_profile', {});
  });
  it('keeps the product-owner stable-sub profile identity across account username changes', async () => {
    mocks.read.mockResolvedValue(null);
    const controller = new LinkedinPostController();
    await controller.getProfile(request({}, 'stable-subject', 'initial-user'), response(), vi.fn());
    await controller.getProfile(request({}, 'stable-subject', 'renamed-user'), response(), vi.fn());
    expect(mocks.read.mock.calls.map((call) => call[1])).toEqual(['stable-subject', 'stable-subject']);
  });
  it('validates profile input and delegates transformation under a distinct write operation', async () => {
    const setup = { name: 'Example author', role: 'Maintainer', focus_areas: 'Code', primary_audience: 'Developers' };
    const profile = linkedinProfileFromSetup(setup);
    const saved: LinkedinStoredProfile = { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) };
    mocks.saveFromInput.mockResolvedValue(saved);
    const req = request({ setup });
    const res = response();
    const next = vi.fn();
    await new LinkedinPostController().saveProfile(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.saveFromInput).toHaveBeenCalledWith(req, 'subject-one', { setup });
    expect(mocks.startOperation).toHaveBeenCalledWith(req, 'update_linkedin_profile', {});
    expect(res.json).toHaveBeenCalledWith({ profile: saved });
    mocks.saveFromInput.mockClear();
    await new LinkedinPostController().saveProfile(request({ profile: { ...profile, about: { ...profile.about, name: 'x'.repeat(4001) } } }), response(), next);
    expect(mocks.saveFromInput).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
  it('passes only validated LFX share-link answers on an owned result poll', async () => {
    const body = {
      project: 'project-one',
      sessionId: 'session-one',
      ownerToken: createSessionOwnerToken('subject-one', 'session-one'),
      answers: { share_link: 'https://public.example/shared' },
    };
    const req = request(body);
    const next = vi.fn();
    await new LinkedinPostController().result(req, response(), next);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.result).toHaveBeenCalledWith(req, 'subject-one', 'session-one', 'project-one', body.answers, 0);
    mocks.result.mockClear();
    await new LinkedinPostController().result(request({ ...body, answers: { share_link: 'javascript:bad' } }), response(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(mocks.result).not.toHaveBeenCalled();
  });
  it('erases only the effective user and requires authentication for deletion', async () => {
    const controller = new LinkedinPostController();
    const req = request({ user: 'other-user' });
    const res = response();
    const next = vi.fn();
    await controller.deleteProfile(req, res, next);
    expect(mocks.delete).toHaveBeenCalledWith(req, 'subject-one');
    expect(mocks.startOperation).toHaveBeenCalledWith(req, 'delete_linkedin_profile', {});
    expect(res.status).toHaveBeenCalledWith(204);
    mocks.delete.mockClear();
    await controller.deleteProfile(request({}, ''), response(), next);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });
});
