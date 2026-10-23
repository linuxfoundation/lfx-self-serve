// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinEnvelope, LinkedinSetup } from '@lfx-one/shared/interfaces';
import { LINKEDIN_FINALIZE_TOOL } from '@lfx-one/shared/constants';
import { LINKEDIN_RECORDED_CASES } from '../../../../../packages/shared/src/constants/linkedin-post-recorded.fixture';
import { LINKEDIN_RECORDED_QUESTIONS, LINKEDIN_RECORDED_ANSWERS } from '../../../../../packages/shared/src/constants/linkedin-post-questions.fixture';
import { linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  followUp: vi.fn(),
  events: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  initialize: vi.fn(),
  saveLink: vi.fn(),
  persist: vi.fn(),
  ingest: vi.fn(),
}));
vi.mock('./guild.service', () => ({
  GuildService: class {
    public createSession = mocks.createSession;
    public getRawEventPayloads = mocks.events;
    public sendFollowUp = mocks.followUp;
  },
}));
vi.mock('./linkedin-profile.service', () => ({
  LinkedinProfileService: class {
    public read = mocks.read;
    public save = mocks.save;
    public initializeOnce = mocks.initialize;
  },
}));
vi.mock('./linkedin-source.service', () => ({
  LinkedinSourceService: class {
    public ingest = mocks.ingest;
  },
}));
vi.mock('./mktg-document-store.service', () => ({
  MktgDocumentStoreService: class {
    public persistGeneration = mocks.persist;
    public saveLinkedinShareLink = mocks.saveLink;
    public runDocumentId() {
      return 'run-0123456789abcdef01234567';
    }
  },
}));
vi.mock('./logger.service', () => ({ logger: { debug: vi.fn(), info: vi.fn() } }));
import { LinkedinPostService } from './linkedin-post.service';

const req = {} as Request;
const setup: LinkedinSetup = { name: 'Example author', role: 'Maintainer', focus_areas: 'Open source', primary_audience: 'Developers' };
function fixture(): LinkedinEnvelope {
  const profile = linkedinProfileFromSetup(setup);
  const markdown = `# LinkedIn post options for ${profile.about.name}\n\nSynthetic options`;
  return {
    contract: 'linkedin-post-output/v1',
    kind: 'linkedin-post',
    version: 1,
    document_markdown: markdown,
    content_sha256: createHash('sha256').update(markdown).digest('hex'),
    profile_source: 'first_run_setup',
    profile,
    profile_markdown: renderLinkedinProfileMarkdown(profile),
    options: [1, 2, 3].map((number) => ({
      number,
      label: `Angle ${number}`,
      text: 'Example release. [LINK]',
      word_count: 3,
      hashtags: ['#Release', '#Community', '#Code'],
      tagging_suggestions: ['Example project'],
    })),
    inputs: { content_source: 'text', feedback_provided: false },
    generated_at: '2026-10-15T10:00:00Z',
    agent: { identifier: 'linux-foundation~linkedin-post', agent_version: '1.0.0', prompt_manifest_sha256: 'a'.repeat(64) },
  };
}
/** Main's paired Anthropic tool-result shape, observed in the recorded2.0 llm_start payload. */
function finalized(value: unknown): string {
  return JSON.stringify({
    type: 'llm_start',
    payload: JSON.stringify({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'synthetic-finalize', name: LINKEDIN_FINALIZE_TOOL, input: {} }] },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'synthetic-finalize',
              content: [{ type: 'text', text: JSON.stringify({ envelope_json: JSON.stringify(value) }) }],
            },
          ],
        },
      ],
    }),
  });
}

describe('LinkedIn generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(null);
    mocks.initialize.mockResolvedValue(true);
    mocks.saveLink.mockResolvedValue({ share_link: '' });
    mocks.createSession.mockResolvedValue('session-1');
    mocks.ingest.mockResolvedValue({ content_source: 'text', content_text: 'Example release' });
    mocks.persist.mockResolvedValue({ project: 'project-1' });
  });
  it('sends the first-run form with the UTC server date, not client today', async () => {
    const result = await new LinkedinPostService().start(req, 'subject-1', { today: 'forged' }, setup, 'linkedin-post', {
      uid: 'project-1',
      name: 'Synthetic project',
    });
    expect(result.documentId).toMatch(/^run-/);
    const request = mocks.createSession.mock.calls[0][1];
    expect(request.message).toContain(`TODAY: ${new Date().toISOString().slice(0, 10)}`);
    expect(request.message).toContain('===== BEGIN PROFILE TO SAVE =====');
    expect(request.message).not.toContain('Do NOT ask the user anything.');
    expect(request.message).toContain('PROFILE GAPS:');
    expect(request.message).toContain('PROJECT SCOPE:');
    expect(request.message).toContain('Synthetic project');
    expect(request.message).toContain('project-1');
    expect(request.message).not.toContain('forged');
  });
  it('returns the LFX share-link answer without adding it to the agent form', async () => {
    const result = await new LinkedinPostService().start(req, 'subject-1', { share_link: 'https://public.example/shared-only' }, setup, 'linkedin-post', {
      uid: 'project-1',
      name: 'Synthetic project',
    });
    expect(result.answers).toEqual({ share_link: 'https://public.example/shared-only' });
    expect(mocks.createSession.mock.calls[0][1].message).not.toContain('https://public.example/shared-only');
    await expect(
      new LinkedinPostService().start(req, 'subject-1', { share_link: 'javascript:bad' }, setup, 'linkedin-post', {
        uid: 'project-1',
        name: 'Synthetic project',
      })
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });
  it('uses the server-stored profile on later runs', async () => {
    const envelope = fixture();
    mocks.read.mockResolvedValue(envelope);
    await new LinkedinPostService().start(req, 'subject-1', {}, undefined, 'linkedin-post', { uid: 'project-1', name: 'Synthetic project' });
    expect(mocks.createSession.mock.calls[0][1].message).toContain('===== BEGIN SAVED PROFILE =====');
  });
  it('refuses unresolved project scope before source ingestion or session creation', async () => {
    await expect(new LinkedinPostService().start(req, 'subject-1', {}, setup, 'linkedin-post', { uid: 'project-1', name: ' ' })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(new LinkedinPostService().start(req, 'subject-1', {}, setup, 'linkedin-post', { uid: '', name: 'Synthetic project' })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it('rejects a first run without setup before spending a session', async () => {
    await expect(
      new LinkedinPostService().start(req, 'subject-1', {}, undefined, 'linkedin-post', { uid: 'project-1', name: 'Synthetic project' })
    ).rejects.toThrow('Validation failed for setup');
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it('never accepts raw/agent text or a page as the finalized output', async () => {
    mocks.events.mockResolvedValue([
      JSON.stringify(fixture()),
      JSON.stringify({ type: 'agent_notification_message', content: { type: 'text', data: JSON.stringify(fixture()) } }),
      JSON.stringify({ type: 'runtime_done', task: { entity_type: 'EntTaskTool' }, content: { envelope_json: JSON.stringify(fixture()) } }),
    ]);
    expect(await new LinkedinPostService().result(req, 'subject-1', 'session-1', 'project-1')).toEqual({ status: 'pending', activity: [] });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('rejects schema and hash failures before choosing a result', async () => {
    mocks.events.mockResolvedValue([finalized({ ...fixture(), content_sha256: 'b'.repeat(64) }), finalized({ ...fixture(), options: [] })]);
    expect(await new LinkedinPostService().result(req, 'subject-1', 'session-1', 'project-1')).toEqual({ status: 'pending', activity: [] });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });
  it('stores a one-off document without profile fields and saves the returned first profile', async () => {
    const envelope = fixture();
    mocks.events.mockResolvedValue([finalized(envelope)]);
    const result = await new LinkedinPostService().result(req, 'subject-1', 'session-1', 'project-1');
    expect(result.status).toBe('ready');
    expect(result.envelope).toEqual(envelope);
    expect(mocks.initialize).toHaveBeenCalledWith(req, 'subject-1', 'session-1', { profile: envelope.profile, profile_markdown: envelope.profile_markdown });
    expect(mocks.save).not.toHaveBeenCalled();
    const document = mocks.persist.mock.calls[0][2];
    expect(document.profile).toBeUndefined();
    expect(document.profile_markdown).toBeUndefined();
    expect(document.document_markdown).toBe('# LinkedIn post options\n\nSynthetic options');
    expect(document.document_markdown).not.toContain(envelope.profile.about.name);
    expect(document.content_sha256).toBe(createHash('sha256').update(document.document_markdown).digest('hex'));
    expect(document.content_sha256).not.toBe(envelope.content_sha256);
    expect(mocks.persist.mock.calls[0].slice(3)).toEqual(['project-1', 'session-1']);
  });
  it('stores LFX link metadata without replacing the raw envelope or persisted placeholder bytes/hash', async () => {
    const envelope = fixture();
    envelope.document_markdown += '\n[LINK]';
    envelope.content_sha256 = createHash('sha256').update(envelope.document_markdown).digest('hex');
    const before = JSON.stringify(envelope);
    mocks.events.mockResolvedValue([finalized(envelope)]);
    const service = new LinkedinPostService();
    await service.result(req, 'subject-1', 'session-1', 'project-1');
    const original = mocks.persist.mock.calls[0][2];
    expect(original).not.toHaveProperty('answers');
    expect(mocks.saveLink).not.toHaveBeenCalled();
    const result = await service.result(req, 'subject-1', 'session-1', 'project-1', { share_link: 'https://public.example/shared' }, 25);
    const stored = mocks.persist.mock.calls[1][2];
    expect(JSON.stringify(result.envelope)).toBe(before);
    expect(stored.document_markdown).toBe(original.document_markdown);
    expect(stored.content_sha256).toBe(original.content_sha256);
    expect(stored.document_markdown).toContain('[LINK]');
    expect(stored.document_markdown).not.toContain('https://public.example/shared');
    expect(stored.answers).toEqual({ share_link: 'https://public.example/shared' });
    expect(mocks.saveLink).toHaveBeenCalledWith(req, 'project-1', 'run-0123456789abcdef01234567', 'https://public.example/shared', true);
    expect(stored.source.words).toBe(25);
  });
  it('honors the durable initializer absence result without replaying a mutable profile save', async () => {
    mocks.events.mockResolvedValue([finalized(fixture())]);
    mocks.initialize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const service = new LinkedinPostService();
    expect((await service.result(req, 'subject-1', 'session-1', 'project-1')).profileSaved).toBe(true);
    expect((await service.result(req, 'subject-1', 'session-1', 'project-1')).profileSaved).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.initialize).toHaveBeenCalledTimes(2);
  });

  it('completes an existing first-run document without auto-saving a profile while impersonating', async () => {
    mocks.events.mockResolvedValue([finalized(fixture())]);
    const impersonated = Object.assign({} as Request, { impersonationActive: true });
    const result = await new LinkedinPostService().result(impersonated, 'subject-1', 'session-1', 'project-1');
    expect(result.status).toBe('ready');
    expect(result.persistence).toBeDefined();
    expect(result.profileSaved).toBe(false);
    expect(mocks.persist).toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(LINKEDIN_RECORDED_CASES)('validates and stores recorded2.0 case $name with additive research', async ({ envelope }) => {
    mocks.events.mockResolvedValue([finalized(envelope)]);
    const result = await new LinkedinPostService().result(req, 'subject-1', 'session-1', 'project-1');
    expect(result.status).toBe('ready');
    expect(result.envelope).toEqual(envelope);
    expect(result.envelope?.inputs).toHaveProperty('research');
    expect(mocks.persist).toHaveBeenCalledOnce();
  });
  it('returns the recorded questions, sends their answers on the SAME session, and never leaks reasoning in any status', async () => {
    const publicProgress = JSON.stringify({
      type: 'agent_notification_progress',
      created_at: '2026-10-19T14:00:00Z',
      content: { type: 'text', data: 'Reading the public source.' },
    });
    const privateProgress = JSON.stringify({
      type: 'agent_notification_progress',
      content: { type: 'application/guild-reasoning-progress', data: 'PRIVATE THOUGHTS', envelope: fixture() },
    });
    const service = new LinkedinPostService();
    mocks.events.mockResolvedValue([publicProgress, privateProgress]);
    const pending = await service.result(req, 'subject-1', 'session-1', 'project-1');
    expect(pending.status).toBe('pending');
    expect(pending.activity?.map((row) => row.label)).toContain('Reading the public source.');
    const questionsEvent = JSON.stringify({ type: 'agent_notification_message', content: { type: 'text', data: LINKEDIN_RECORDED_QUESTIONS } });
    mocks.events.mockResolvedValue([publicProgress, privateProgress, questionsEvent]);
    const questions = await service.result(req, 'subject-1', 'session-1', 'project-1');
    expect(questions.status).toBe('questions');
    expect(questions.questions?.map((question) => question.key)).toEqual(['tendency', 'admired-style', 'avoid']);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    if (!questions.questionsId || !questions.questions) throw new Error('Expected recorded gap round');
    const answers = questions.questions.map((question) => ({ key: question.key, text: question.suggestedAnswer, origin: 'accepted' as const }));
    await service.sendAnswers(req, 'session-1', questions.questionsId, answers, 'linkedin-post');
    expect(mocks.followUp).toHaveBeenCalledWith(req, 'session-1', { message: LINKEDIN_RECORDED_ANSWERS, handle: 'linkedin-post' });
    await expect(
      service.sendAnswers(req, 'session-1', questions.questionsId, [{ key: 'tone', text: 'Not an asked gap.', origin: 'requester' }], 'linkedin-post')
    ).rejects.toMatchObject({ statusCode: 400 });
    mocks.events.mockResolvedValue([publicProgress, privateProgress, finalized(fixture())]);
    const ready = await service.result(req, 'subject-1', 'session-1', 'project-1');
    expect(ready.status).toBe('ready');
    mocks.events.mockResolvedValue([questionsEvent, finalized(fixture())]);
    await service.sendAnswers(req, 'session-1', questions.questionsId, answers, 'linkedin-post');
    expect(mocks.followUp).toHaveBeenCalledTimes(1);
    expect(mocks.createSession).not.toHaveBeenCalled();
    for (const state of [pending, questions, ready]) expect(JSON.stringify(state)).not.toContain('PRIVATE');
  });

  it('completes a saved run for its original creator without adopting the visiting reader identity', async () => {
    mocks.events.mockResolvedValue([finalized(fixture())]);
    const visitor = Object.assign({}, req, { oidc: { ...req.oidc, user: { sub: 'synthetic-visitor' } } });
    await new LinkedinPostService({ creatorSubject: 'synthetic-creator' }, true).result(visitor, 'synthetic-creator', 'session-1', 'project-1');
    expect(mocks.initialize).toHaveBeenCalledWith(visitor, 'synthetic-creator', 'session-1', expect.anything());
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it('keeps an impersonated start from initializing a profile on a later non-impersonated completion', async () => {
    mocks.events.mockResolvedValue([finalized(fixture())]);
    const result = await new LinkedinPostService({ creatorSubject: 'synthetic-target' }, false).result(req, 'synthetic-target', 'session-1', 'project-1');
    expect(result.status).toBe('ready');
    expect(result.profileSaved).toBe(false);
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it('does not overwrite an intervening profile edit on a repeated result poll', async () => {
    mocks.events.mockResolvedValue([finalized(fixture())]);
    mocks.read.mockResolvedValue({ profile: 'newer voice' });
    await new LinkedinPostService().result(req, 'subject-1', 'session-1', 'project-1');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
