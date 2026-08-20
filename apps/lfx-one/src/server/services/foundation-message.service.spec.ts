// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/**
 * Contract-true derivatives: inside the §1a word caps, boilerplate inside the
 * 50-250 band, `llms_txt` opening with an H1, and every value embedded
 * verbatim in the document below (gate G3) — the same envelope the agent's
 * finalize tool would emit.
 */
const DERIVATIVES: Record<string, string> = {
  summary_25: 'TestOrbit is an open source toolkit that helps platform teams ship reliable services faster.',
  summary_50:
    'TestOrbit is an open source toolkit that helps platform teams ship reliable services faster, with sensible defaults, transparent governance, and a contributor community that reviews every change in the open.',
  boilerplate:
    'TestOrbit is an open source toolkit for platform teams who need to ship reliable services without assembling their own release toolchain. It packages opinionated defaults for building, testing, and rolling out changes, and keeps every decision inspectable so teams can adapt it to their own environment. Governed in the open under the Linux Foundation, TestOrbit is maintained by contributors from a range of organisations who review each change in public. Adopters use it to shorten the path from a merged pull request to a production release while keeping the audit trail their compliance teams expect.',
  llms_txt: '# TestOrbit\n\nTestOrbit is an open source toolkit for platform teams.',
  elevator_pitch_headline: 'Ship reliable services faster with TestOrbit',
};

function buildDocument(): string {
  const filler = 'Synthetic fixture prose for the Message Foundation structural gate. '.repeat(3);
  const sections = ['# TestOrbit Message Foundation', ''];
  for (const heading of FOUNDATION_MESSAGE_REQUIRED_HEADINGS) {
    sections.push(heading, '', filler, '');
    if (heading.startsWith('## 1a.')) {
      // The document is the single source for the derivatives (gate G3).
      sections.push(...Object.values(DERIVATIVES), '');
    }
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
    derivatives: { ...DERIVATIVES },
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  interface CreateSessionParams {
    message?: string;
    agentInput?: Record<string, unknown>;
    handle?: string;
  }
  const sentParams = (call = 0): CreateSessionParams => guildMocks.createSession.mock.calls[call][1] as CreateSessionParams;

  it('submits the rendered form-mode text by default (live-smoke verdict: Guild coerces structured inputs to raw JSON text)', async () => {
    const sessionId = await service.startGeneration(req, answers(), {}, 'foundation-message');

    expect(sessionId).toBe('session-1');
    expect(guildMocks.createSession).toHaveBeenCalledTimes(1);
    const params = sentParams();
    expect(params.handle).toBe('foundation-message');
    expect(params.agentInput).toBeUndefined();
    // The agent's MODE RULES preamble plus verbatim Q/A pairs and fenced documents.
    expect(params.message).toContain('BATCH INTAKE SUBMISSION (form mode — see MODE RULES in your instructions).');
    expect(params.message).toContain('A1a. TestOrbit');
    expect(params.message).toContain('A1b. https://github.com/example-org/testorbit');
    expect(params.message).toContain(`===== BEGIN BRAND KIT DOCUMENT =====\n${answers()['brand_kit_markdown']}\n===== END BRAND KIT DOCUMENT =====`);
    expect(params.message).toContain('===== BEGIN GITHUB README =====\n# TestOrbit readme\n===== END GITHUB README =====');
  });

  it('submits the typed form payload as the structured agent_input when GUILD_STRUCTURED_AGENT_INPUT=true', async () => {
    vi.stubEnv('GUILD_STRUCTURED_AGENT_INPUT', 'true');

    await service.startGeneration(req, answers(), {}, 'foundation-message');

    const params = sentParams();
    expect(params.handle).toBe('foundation-message');
    expect(params.message).toBeUndefined();
    expect(params.agentInput).toMatchObject({
      type: 'message_foundation_intake_form',
      project_name: 'TestOrbit',
      github_url: 'https://github.com/example-org/testorbit',
      brand_kit_markdown: answers()['brand_kit_markdown'],
      readme_markdown: '# TestOrbit readme',
    });
  });

  it('NEVER blocks the run on a failed README fetch — the no-README grounding lines are rendered instead', async () => {
    readmeMocks.fetchReadme.mockResolvedValue(null);

    await service.startGeneration(req, answers(), {}, 'foundation-message');

    const message = sentParams().message ?? '';
    expect(message).toContain('No README content was provided.');
    expect(message).not.toContain('===== BEGIN GITHUB README =====');
  });

  it('carries feedback + prior_version on a regeneration, and synthesizes the revision note without feedback', async () => {
    await service.startGeneration(req, answers(), { feedback: 'Sharpen it', priorVersion: 2 }, 'foundation-message');
    let message = sentParams().message ?? '';
    expect(message).toContain('FEEDBACK on draft v2 — regenerate incorporating it and finalize as version 3:');
    expect(message).toContain('Sharpen it');

    await service.startGeneration(req, answers(), { priorVersion: 1 }, 'foundation-message');
    message = sentParams(1).message ?? '';
    expect(message).toContain('FEEDBACK on draft v1 — regenerate incorporating it and finalize as version 2:');
    expect(message).toContain(FOUNDATION_MESSAGE_REVISED_INTAKE_FEEDBACK);
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
    expect(result.derivatives).toMatchObject({ summary_25: DERIVATIVES['summary_25'], elevator_pitch_headline: DERIVATIVES['elevator_pitch_headline'] });
    expect(result.documentMarkdown).toContain('## 6. Messaging Pillars');
  });

  it('suppresses an envelope whose derivatives break the §1a word-count locks (never surfaced as "word-count-locked")', async () => {
    const overLongHeadline = 'This elevator pitch headline runs well past the contract hard cap of ten words easily';
    const document = `${buildDocument()}\n${overLongHeadline}\n`;
    const forged = buildEnvelope({
      document_markdown: document,
      content_sha256: createHash('sha256').update(document, 'utf8').digest('hex'),
      derivatives: { ...DERIVATIVES, elevator_pitch_headline: overLongHeadline },
    });
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(forged)]);

    expect(await service.getResult(req, 'session-1')).toEqual({ status: 'pending' });
  });

  it('suppresses an envelope whose derivative is not verbatim in the hash-verified document (gate G3)', async () => {
    const forged = buildEnvelope({ derivatives: { ...DERIVATIVES, summary_25: 'A summary that the document itself never contains.' } });
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(forged)]);

    expect(await service.getResult(req, 'session-1')).toEqual({ status: 'pending' });
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
