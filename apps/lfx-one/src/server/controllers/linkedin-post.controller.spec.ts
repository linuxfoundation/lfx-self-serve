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
import { MKTG_ANSWERS_INCOMPLETE_MESSAGE } from '@lfx-one/shared/constants/mktg-run.constants';
const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  history: vi.fn(),
  ownedResult: vi.fn(),
  attribution: vi.fn(),
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
    public ownedOneOffResult = mocks.ownedResult;
    public startForOneOff = mocks.track;
    public recordResultBestEffort = mocks.record;
    public resumeAfterQuestions = mocks.resume;
  },
}));
vi.mock('../services/mktg-last-intake.service', () => ({
  MktgLastIntakeService: class {
    public recordStartBestEffort = mocks.history;
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
    public constructor(...args: unknown[]) {
      mocks.attribution(...args);
    }
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
vi.mock('../services/logger.service', () => ({ logger: { startOperation: mocks.startOperation, success: vi.fn(), warning: vi.fn() } }));
import { LinkedinPostController } from './linkedin-post.controller';
import { logger } from '../services/logger.service';

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
    mocks.project.mockResolvedValue({ uid: 'project-one', name: 'Synthetic project', writer: true });
    mocks.preflight.mockImplementation(async (req: Request, project: unknown) => {
      if (typeof project !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw Object.assign(new Error('Invalid project'), { statusCode: 400 });
      const resolved = await mocks.project(req, project);
      if (!resolved.writer) throw Object.assign(new Error('No access'), { statusCode: 403 });
      return resolved.uid;
    });
    mocks.ownedResult.mockReset().mockResolvedValue({ status: 'pending' });
    mocks.track.mockResolvedValue('a'.repeat(64));
    mocks.history.mockReset().mockResolvedValue(undefined);
    mocks.start.mockResolvedValue({ sessionId: 'session-one', documentId: 'run-0123456789abcdef01234567', source: { words: 12 } });
    mocks.result.mockResolvedValue({ status: 'pending' });
  });
  it('delegates owned completion only after HMAC and writer checks, without applying policy in the controller', async () => {
    const body = { sessionId: 'session-one', ownerToken: createSessionOwnerToken('subject-one', 'session-one'), project: 'project-one' };
    const next = vi.fn();
    const controller = new LinkedinPostController();
    const req = request(body);
    await controller.result(req, response(), next);
    expect(next).not.toHaveBeenCalled();
    expect(mocks.ownedResult).toHaveBeenCalledWith(req, 'project-one', 'linkedin-post', 'session-one', { answers: undefined, sourceWords: 0 });
    expect(mocks.result).not.toHaveBeenCalled();
    mocks.ownedResult.mockClear();
    await controller.result(request({ ...body, ownerToken: 'forged' }), response(), next);
    expect(mocks.ownedResult).not.toHaveBeenCalled();
    mocks.project.mockResolvedValue({ uid: 'project-one', writer: false });
    await controller.result(request(body), response(), next);
    expect(mocks.ownedResult).not.toHaveBeenCalled();
  });

  it('refuses a non-answer with the plain 400 before sending or resuming', async () => {
    const next = vi.fn();
    const res = response();
    await new LinkedinPostController().answer(
      request({
        sessionId: 'session-one',
        ownerToken: createSessionOwnerToken('subject-one', 'session-one'),
        project: 'project-one',
        questionsId: 'a'.repeat(64),
        answers: [{ key: 'role', text: 'TBD', origin: 'requester' }],
      }),
      res,
      next
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        validationErrors: [{ code: 'FIELD_VALIDATION_ERROR', field: 'answers', message: MKTG_ANSWERS_INCOMPLETE_MESSAGE }],
      })
    );
    expect(mocks.answer).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
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
    expect(mocks.history).toHaveBeenCalledWith(req, {
      project: 'project-one',
      agentId: 'linkedin-post',
      runId: 'a'.repeat(64),
      answers: req.body.answers,
      documentCount: 0,
      logoCount: 0,
    });
    expect(mocks.track.mock.invocationCallOrder[0]).toBeLessThan(mocks.history.mock.invocationCallOrder[0]);
    expect(vi.mocked(res.json).mock.invocationCallOrder[0]).toBeLessThan(mocks.history.mock.invocationCallOrder[0]);
  });

  it.each(['start', 'track'] as const)('records no last intake when %s fails', async (step) => {
    mocks[step].mockRejectedValueOnce(new Error('Synthetic failure'));
    const next = vi.fn();
    await new LinkedinPostController().generate(
      request({ project: 'project-one', answers: { content_source: 'text', content_text: 'Synthetic source' } }),
      response(),
      next
    );
    expect(next).toHaveBeenCalled();
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it('does not await the service-owned history projection after an accepted Generate', async () => {
    const req = request({ project: 'project-one', answers: { content_source: 'file', content_file_base64: 'private-upload' } });
    const next = vi.fn();
    const res = response();
    mocks.history.mockImplementationOnce(() => new Promise<void>(() => undefined));
    await new LinkedinPostController().generate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledOnce();
    expect(mocks.history.mock.calls[0][1].answers).toBe(req.body.answers);
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
    expect(mocks.start).toHaveBeenCalledWith(expect.anything(), 'subject-one', expect.anything(), undefined, 'linkedin-post', {
      uid: 'project-one',
      name: 'Synthetic project',
      writer: true,
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ownerToken: createSessionOwnerToken('subject-one', 'session-one') }));
  });
  it('logs and sends the resolved terminal outcome, never an earlier pending status', async () => {
    mocks.ownedResult.mockResolvedValue({ status: 'failed' });
    const res = response();
    const next = vi.fn();
    await new LinkedinPostController().result(
      request({ project: 'project-one', sessionId: 'session-one', ownerToken: createSessionOwnerToken('subject-one', 'session-one') }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ status: 'failed' });
    expect(logger.success).toHaveBeenCalledWith(expect.anything(), 'linkedin_result', 0, { status: 'failed' });
  });
  it('validates source word bounds before writer lookup and passes only typed fallback context', async () => {
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
    expect(mocks.ownedResult).toHaveBeenCalledWith(expect.anything(), 'project-one', 'linkedin-post', 'session-one', {
      answers: undefined,
      sourceWords: LINKEDIN_SOURCE_MAX_WORDS,
    });
    mocks.project.mockClear();
    mocks.ownedResult.mockClear();
    await controller.result(request({ ...body, sourceWords: LINKEDIN_SOURCE_MAX_WORDS + 1 }), response(), next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.ownedResult).not.toHaveBeenCalled();
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
  it('validates LFX share-link inputs before writer lookup and passes only typed fallback context', async () => {
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
    expect(mocks.ownedResult).toHaveBeenCalledWith(req, 'project-one', 'linkedin-post', 'session-one', { answers: body.answers, sourceWords: 0 });
    mocks.project.mockClear();
    mocks.ownedResult.mockClear();
    await new LinkedinPostController().result(request({ ...body, answers: { share_link: 'javascript:bad' } }), response(), next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mocks.project).not.toHaveBeenCalled();
    expect(mocks.ownedResult).not.toHaveBeenCalled();
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
