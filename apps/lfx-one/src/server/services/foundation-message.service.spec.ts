// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors brand-kit.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired
// into this app's vitest config with Angular-free resolution, so shared runtime
// collaborators are mocked — except the pure foundation-message + envelope
// utils, which are re-exported through the mock from their real (Angular-free)
// source modules so the spec exercises the real payload/validation logic.
const guildMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getRawEventPayloads: vi.fn(),
}));
const readmeMocks = vi.hoisted(() => ({
  fetchReadme: vi.fn(),
}));

vi.mock('@lfx-one/shared/utils', async () => {
  const foundationMessage = await vi.importActual('../../../../../packages/shared/src/utils/foundation-message.utils');
  const envelope = await vi.importActual('../../../../../packages/shared/src/utils/mktg-envelope.utils');
  return { ...(foundationMessage as object), ...(envelope as object) };
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/foundation-message.constants');
  return constants;
});
vi.mock('./guild.service', () => ({
  GuildService: class {
    public createSession = guildMocks.createSession;
    public getRawEventPayloads = guildMocks.getRawEventPayloads;
  },
}));
vi.mock('./github-readme.service', () => ({
  GithubReadmeService: class {
    public fetchReadme = readmeMocks.fetchReadme;
  },
}));
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { Request } from 'express';

import { FOUNDATION_MESSAGE_REQUIRED_HEADINGS, FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK } from '@lfx-one/shared/constants';

import { FoundationMessageService } from './foundation-message.service';

const req = { path: '/api/mktg-agents/foundation-message/generate' } as unknown as Request;

const answers = (): Record<string, string> => ({
  project_name: 'TestOrbit',
  github_url: 'https://github.com/example-org/testorbit',
  brand_kit_markdown: '# TestOrbit Brand Kit\n\nVoice: clear.',
});

function buildDocument(): string {
  const filler = 'Synthetic fixture prose for the Message Foundation structural gate. '.repeat(3);
  const sections = ['# TestOrbit Message Foundation', ''];
  for (const heading of FOUNDATION_MESSAGE_REQUIRED_HEADINGS) {
    sections.push(heading, '', filler, '');
  }
  return sections.join('\n');
}

function buildEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const documentMarkdown = (overrides['document_markdown'] as string) ?? buildDocument();
  return {
    contract: 'message-foundation-output/v1',
    kind: 'message-foundation',
    project: 'testorbit',
    project_name: 'TestOrbit',
    version: 1,
    document_markdown: documentMarkdown,
    content_sha256: createHash('sha256').update(documentMarkdown, 'utf8').digest('hex'),
    derivatives: {
      summary_25: 'Twenty-five word summary.',
      summary_50: 'Fifty word summary.',
      boilerplate: 'Boilerplate paragraph.',
      llms_txt: '# TestOrbit\nAbout the project.',
      elevator_pitch_headline: 'TestOrbit orbits tests',
    },
    inputs: { brand_kit_provided: true },
    intake: {
      mode: 'form',
      completed_at: '2026-08-20T00:00:00Z',
      answers: [
        { question_number: 1, question: 'Q1a?', answer: 'TestOrbit' },
        { question_number: 2, question: 'Q1b?', answer: 'https://github.com/example-org/testorbit' },
      ],
    },
    ...overrides,
  };
}

/** Wraps an envelope the way the authoritative finalize tool result rides raw events. */
const toolResultPayload = (envelope: Record<string, unknown>): string =>
  JSON.stringify({ type: 'llm_done', content: { envelope_json: JSON.stringify(envelope) } });

describe('FoundationMessageService.startGeneration', () => {
  let service: FoundationMessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FoundationMessageService();
    guildMocks.createSession.mockResolvedValue('session-1');
    readmeMocks.fetchReadme.mockResolvedValue('# TestOrbit readme');
  });

  it('submits the typed form payload as the structured agent_input with the catalog handle', async () => {
    const sessionId = await service.startGeneration(req, answers(), {}, 'foundation-message');

    expect(sessionId).toBe('session-1');
    expect(guildMocks.createSession).toHaveBeenCalledTimes(1);
    const params = guildMocks.createSession.mock.calls[0][1] as { agentInput: Record<string, unknown>; handle: string };
    expect(params.handle).toBe('foundation-message');
    expect(params.agentInput).toMatchObject({
      type: 'message_foundation_intake_form',
      project_name: 'TestOrbit',
      github_url: 'https://github.com/example-org/testorbit',
      brand_kit_markdown: answers()['brand_kit_markdown'],
      readme_markdown: '# TestOrbit readme',
    });
  });

  it('NEVER blocks the run on a failed README fetch — readme_markdown is simply omitted', async () => {
    readmeMocks.fetchReadme.mockResolvedValue(null);

    await service.startGeneration(req, answers(), {}, 'foundation-message');

    const params = guildMocks.createSession.mock.calls[0][1] as { agentInput: Record<string, unknown> };
    expect('readme_markdown' in params.agentInput).toBe(false);
  });

  it('carries feedback + prior_version on a regeneration, and synthesizes the revision note without feedback', async () => {
    await service.startGeneration(req, answers(), { feedback: 'Sharpen it', priorVersion: 2 }, 'foundation-message');
    let params = guildMocks.createSession.mock.calls[0][1] as { agentInput: Record<string, unknown> };
    expect(params.agentInput['feedback']).toBe('Sharpen it');
    expect(params.agentInput['prior_version']).toBe(2);

    await service.startGeneration(req, answers(), { priorVersion: 1 }, 'foundation-message');
    params = guildMocks.createSession.mock.calls[1][1] as { agentInput: Record<string, unknown> };
    expect(params.agentInput['feedback']).toBe(FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK);
    expect(params.agentInput['prior_version']).toBe(1);
  });
});

describe('FoundationMessageService.getResult', () => {
  let service: FoundationMessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FoundationMessageService();
  });

  it('reports pending while no valid envelope exists in the event stream', async () => {
    guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_start' }), 'agent chatter']);

    expect(await service.getResult(req, 'session-1')).toEqual({ status: 'pending' });
  });

  it('returns the validated document with its derivatives when the envelope passes every gate', async () => {
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);

    const result = await service.getResult(req, 'session-1');

    expect(result.status).toBe('ready');
    expect(result.version).toBe(1);
    expect(result.projectName).toBe('TestOrbit');
    expect(result.intakeMode).toBe('form');
    expect(result.derivatives).toMatchObject({ summary_25: 'Twenty-five word summary.', elevator_pitch_headline: 'TestOrbit orbits tests' });
    expect(result.documentMarkdown).toContain('## 6. Messaging Pillars');
  });

  it('discards a candidate whose content_sha256 does not match the document bytes — an older hash-valid envelope still wins', async () => {
    const valid = buildEnvelope();
    const forged = buildEnvelope({ version: 2, content_sha256: 'a'.repeat(64) });
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(valid), toolResultPayload(forged)]);

    const result = await service.getResult(req, 'session-1');

    expect(result.status).toBe('ready');
    expect(result.version).toBe(1);
  });

  it('selects the highest version among valid candidates (regeneration supersedes the prior draft)', async () => {
    const v1 = buildEnvelope();
    const v2Document = buildDocument().replace('# TestOrbit Message Foundation', '# TestOrbit Message Foundation v2');
    const v2 = buildEnvelope({
      version: 2,
      document_markdown: v2Document,
      content_sha256: createHash('sha256').update(v2Document, 'utf8').digest('hex'),
    });
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(v2), toolResultPayload(v1)]);

    const result = await service.getResult(req, 'session-1');

    expect(result.version).toBe(2);
    expect(result.documentMarkdown).toContain('Message Foundation v2');
  });
});
