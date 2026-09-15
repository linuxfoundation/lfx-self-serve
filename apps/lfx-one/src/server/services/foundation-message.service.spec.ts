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
// Persistence runs through the SHARED agent-artifact layer, whose own
// collaborators (object store, project entitlement lookup) are mocked here the
// same way brand-kit.service.spec.ts mocks them.
const objectStoreMocks = vi.hoisted(() => ({
  putContentAddressedObject: vi.fn(),
  listObjects: vi.fn(),
  getObject: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
}));

vi.mock('@lfx-one/shared/utils', async () => {
  const foundationMessage = await vi.importActual('../../../../../packages/shared/src/utils/foundation-message.utils');
  const envelope = await vi.importActual('../../../../../packages/shared/src/utils/mktg-envelope.utils');
  const artifact = await vi.importActual('../../../../../packages/shared/src/utils/mktg-artifact.utils');
  return { ...(foundationMessage as object), ...(envelope as object), ...(artifact as object) };
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/foundation-message.constants');
  const artifact = await vi.importActual('../../../../../packages/shared/src/constants/mktg-artifact.constants');
  return { ...(artifact as object), ...(constants as object) };
});
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public putContentAddressedObject = objectStoreMocks.putContentAddressedObject;
    public listObjects = objectStoreMocks.listObjects;
    public getObject = objectStoreMocks.getObject;
  },
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));
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
    readmeMocks.fetchReadme.mockResolvedValue({ readme: '# TestOrbit readme', outcome: { fetched: true, source: 'repository' } });
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
    const start = await service.startGeneration(req, answers(), {}, 'foundation-message');

    expect(start.sessionId).toBe('session-1');
    // The README outcome rides back with the session so the run can label a
    // document generated without one.
    expect(start.readme).toEqual({ fetched: true, source: 'repository' });
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
    readmeMocks.fetchReadme.mockResolvedValue({ readme: null, outcome: { fetched: false, skipReason: 'not-a-repo-url' } });

    const start = await service.startGeneration(req, answers(), {}, 'foundation-message');

    const message = sentParams().message ?? '';
    expect(message).toContain('No README content was provided.');
    expect(message).not.toContain('===== BEGIN GITHUB README =====');
    // Best-effort, but never silent: the run reports WHY it had no README.
    expect(start.readme).toEqual({ fetched: false, skipReason: 'not-a-repo-url' });
  });

  it('logs a README-less generation at warning with its reason — a thin document must be explainable from the logs', async () => {
    const { logger } = await import('./logger.service');
    readmeMocks.fetchReadme.mockResolvedValue({ readme: null, outcome: { fetched: false, skipReason: 'no-readme' } });

    await service.startGeneration(req, answers(), {}, 'foundation-message');

    expect(logger.warning).toHaveBeenCalledWith(
      req,
      'foundation_message_generate',
      expect.stringContaining('without a README'),
      expect.objectContaining({ reason: 'no-readme' })
    );
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

/**
 * The gap this WorkItem closes: before it, a Message Foundation existed only
 * in the browser that generated it, so no dependent agent — and no other user
 * of the project — could reach one. These assert the SAME persistence contract
 * the Brand Kit has always had, because it is now literally the same code.
 */
describe('FoundationMessageService persistence', () => {
  const PROJECT_UID = 'proj-uid-1';
  let service: FoundationMessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    objectStoreMocks.putContentAddressedObject.mockResolvedValue(true);
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT_UID, slug: 'testorbit', writer: true });
    service = new FoundationMessageService();
  });

  it('writes the ready document under the SERVER-resolved project partition and returns the receipt', async () => {
    const envelope = buildEnvelope();
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(envelope)]);

    const result = await service.getResult(req, 'session-1', PROJECT_UID);

    // The partition is the resolved LFX project uid — NEVER the envelope's own
    // `project` slug ('testorbit'), which the read path never lists.
    const expectedKey = `foundation-message/${PROJECT_UID}/${envelope['content_sha256']}.md`;
    expect(projectMocks.getProjectById).toHaveBeenCalledWith(req, PROJECT_UID, true);
    const [, purpose, key, body, contentType, cacheControl, metadata] = objectStoreMocks.putContentAddressedObject.mock.calls[0];
    expect(purpose).toBe('marketing-os-artifacts');
    expect(key).toBe(expectedKey);
    expect(body.toString('utf8')).toBe(envelope['document_markdown']);
    expect(contentType).toBe('text/markdown; charset=utf-8');
    expect(cacheControl).toBe('private');
    expect(metadata).toEqual({ version: '1', 'intake-mode': 'form' });
    expect(result.persistence).toEqual({
      s3_key: expectedKey,
      content_sha256: envelope['content_sha256'],
      project: PROJECT_UID,
      version: 1,
      intake_mode: 'form',
    });
  });

  it('never writes into a partition the caller cannot write: no writer grant, no persistence', async () => {
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT_UID, slug: 'testorbit', writer: false });
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);

    const result = await service.getResult(req, 'session-1', PROJECT_UID);

    expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
    // The document was already validated for its creator — they still get it.
    expect(result.status).toBe('ready');
    expect(result.persistence).toBeUndefined();
  });

  it('does not persist a run with no project scope, and a pending poll costs no upstream lookup', async () => {
    guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_start' })]);
    await service.getResult(req, 'session-1', PROJECT_UID);
    expect(projectMocks.getProjectById).not.toHaveBeenCalled();

    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);
    const result = await service.getResult(req, 'session-1');

    expect(projectMocks.getProjectById).not.toHaveBeenCalled();
    expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
    expect(result.status).toBe('ready');
    expect(result.persistence).toBeUndefined();
  });

  it('degrades a storage failure to no receipt — the document still reaches the user', async () => {
    objectStoreMocks.putContentAddressedObject.mockRejectedValue(new Error('storage down'));
    const envelope = buildEnvelope();
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(envelope)]);

    const result = await service.getResult(req, 'session-1', PROJECT_UID);

    expect(result.status).toBe('ready');
    expect(result.documentMarkdown).toBe(envelope['document_markdown']);
    expect(result.persistence).toBeUndefined();
  });

  it('serves the project’s latest stored document from the partition the write path wrote to', async () => {
    const envelope = buildEnvelope();
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(envelope)]);
    const written = await service.getResult(req, 'session-1', PROJECT_UID);
    const writtenKey = written.persistence?.s3_key as string;

    objectStoreMocks.listObjects.mockResolvedValue([{ key: writtenKey, lastModified: new Date('2026-09-01T00:00:00Z') }]);
    objectStoreMocks.getObject.mockResolvedValue({ body: envelope['document_markdown'], metadata: { version: '1', 'intake-mode': 'form' } });

    const stored = await service.getStoredFoundationMessage(req, PROJECT_UID);

    const [, , listedPrefix] = objectStoreMocks.listObjects.mock.calls[0];
    expect(listedPrefix).toBe(`foundation-message/${PROJECT_UID}/`);
    expect(writtenKey.startsWith(listedPrefix)).toBe(true);
    expect(stored?.documentMarkdown).toBe(envelope['document_markdown']);
    expect(stored?.receipt.s3_key).toBe(writtenKey);
    expect(stored?.storedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('degrades a stored-document read failure to null rather than failing the caller', async () => {
    objectStoreMocks.listObjects.mockRejectedValue(new Error('bucket unreachable'));

    await expect(service.getStoredFoundationMessage(req, PROJECT_UID)).resolves.toBeNull();
  });
});
