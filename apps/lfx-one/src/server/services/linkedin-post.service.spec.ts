// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinEnvelope, LinkedinSetup } from '@lfx-one/shared/interfaces';
import { LINKEDIN_FINALIZE_TOOL } from '@lfx-one/shared/constants';
import { LINKEDIN_RECORDED_CASES } from '../../../../../packages/shared/src/constants/linkedin-post-recorded.fixture';
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
    const result = await new LinkedinPostService().start(req, 'subject-1', { today: 'forged' }, setup, 'linkedin-post');
    expect(result.documentId).toMatch(/^run-/);
    const request = mocks.createSession.mock.calls[0][1];
    expect(request.message).toContain(`TODAY: ${new Date().toISOString().slice(0, 10)}`);
    expect(request.message).toContain('===== BEGIN PROFILE TO SAVE =====');
    expect(request.message).not.toContain('Do NOT ask the user anything.');
    expect(request.message).toContain('PROFILE GAPS:');
    expect(request.message).toContain('PROJECT SCOPE:');
    expect(request.message).not.toContain('forged');
  });

  it('rejects a first run without setup before spending a session', async () => {
    await expect(new LinkedinPostService().start(req, 'subject-1', {}, undefined, 'linkedin-post')).rejects.toThrow('Validation failed for setup');
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

  it('honors the durable initializer absence result without replaying a mutable profile save', async () => {
    mocks.events.mockResolvedValue([finalized(fixture())]);
    mocks.initialize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const service = new LinkedinPostService();
    expect((await service.result(req, 'subject-1', 'session-1', 'project-1')).profileSaved).toBe(true);
    expect((await service.result(req, 'subject-1', 'session-1', 'project-1')).profileSaved).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.initialize).toHaveBeenCalledTimes(2);
  });

  it.each(LINKEDIN_RECORDED_CASES)('validates and stores recorded2.0 case $name with additive research', async ({ envelope }) => {
    mocks.events.mockResolvedValue([finalized(envelope)]);
    const result = await new LinkedinPostService().result(req, 'subject-1', 'session-1', 'project-1');
    expect(result.status).toBe('ready');
    expect(result.envelope).toEqual(envelope);
    expect(result.envelope?.inputs).toHaveProperty('research');
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it('does not overwrite an intervening profile edit on a repeated result poll', async () => {
    mocks.events.mockResolvedValue([finalized(fixture())]);
    mocks.read.mockResolvedValue({ profile: 'newer voice' });
    await new LinkedinPostService().result(req, 'subject-1', 'session-1', 'project-1');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
