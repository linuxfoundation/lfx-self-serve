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
const sourceTextMocks = vi.hoisted(() => ({
  readLink: vi.fn(),
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
vi.mock('./mktg-source-text.service', () => ({
  MktgSourceTextService: class {
    public readLink = sourceTextMocks.readLink;
  },
}));
// The document store records revisions on top of the agent's own write and
// has its own spec (mktg-document-store.service.spec.ts). Here it passes
// through, so this spec keeps asserting the agent's persistence, plus the
// session id the store keys revisions by.
const documentStoreMocks = vi.hoisted(() => ({ recordedSessions: [] as string[] }));
vi.mock('./mktg-document-store.service', async () => {
  const { MktgArtifactService } = await import('./mktg-artifact.service');
  return {
    MktgDocumentStoreService: class {
      private readonly artifactService = new MktgArtifactService();
      public persistGeneration(req: Request, spec: MktgArtifactSpec, envelope: MktgArtifactEnvelope, projectUid: string | undefined, sessionId: string) {
        documentStoreMocks.recordedSessions.push(sessionId);
        return this.artifactService.persist(req, spec, envelope, projectUid);
      }
      public readLatest(req: Request, spec: MktgArtifactSpec, project: string) {
        return this.artifactService.readLatest(req, spec, project);
      }
    },
  };
});
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import type { MktgArtifactEnvelope, MktgArtifactSpec } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { FOUNDATION_MESSAGE_FIELD_IDS, FOUNDATION_MESSAGE_LIST_FIELD_IDS, FOUNDATION_MESSAGE_REQUIRED_HEADINGS } from '@lfx-one/shared/constants';

import { FoundationMessageService } from './foundation-message.service';

const req = { path: '/api/mktg-agents/foundation-message/generate' } as unknown as Request;

const answers = (): Record<string, string> => ({
  project_name: 'TestOrbit',
  website_url: 'https://testorbit.example.org',
  github_url: 'https://github.com/example-org/testorbit',
  press_release_url: 'https://press.example.org/testorbit',
  brand_page_url: 'none',
  vision_mission: 'Vision: reliable releases for everyone.',
  category: 'Release tooling.',
  audiences: 'Platform teams.',
  alternatives: 'Hand-built pipelines.',
  differentiation: 'Neutral governance.',
  use_cases: 'Build, test, roll out.',
  proof_points: 'TBD',
  pillars: 'Reliability; openness; speed.',
  objections: 'Is it mature? Yes, since 2024.',
  tagline_ctas_constraints: 'skip',
});

/** The copy primitives, contract-true: inside their caps, the boilerplate in its band, embedded verbatim in the document. */
const PRIMITIVES: Record<string, string> = {
  'md.summary_25': 'TestOrbit is an open source toolkit that helps platform teams ship reliable services faster.',
  'md.summary_50': 'TestOrbit is an open source toolkit that helps platform teams ship reliable services faster, governed in the open.',
  'md.boilerplate': 'TestOrbit is an open source toolkit for platform teams. '.repeat(10).trim(),
  'md.llms_txt': '# TestOrbit',
  'md.elevator_pitch': 'TestOrbit gives platform teams one open source toolkit for reliable releases.',
  'md.positioning': 'For platform teams, TestOrbit is the open release toolkit.',
};

function buildDocument(title = '# TestOrbit Messaging Document'): string {
  const filler = 'Synthetic fixture prose for the Messaging Document structural gate. '.repeat(2);
  const lines = [title, '', '| Status | Draft — from your documents |', ''];
  for (const heading of FOUNDATION_MESSAGE_REQUIRED_HEADINGS) {
    lines.push(heading, '', filler, '');
  }
  lines.push(...Object.values(PRIMITIVES), PRIMITIVES['md.positioning'], 'md.governance_sentence value', 'md.trademark_sentence value');
  return lines.join('\n');
}

function buildEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const documentMarkdown = (overrides['document_markdown'] as string) ?? buildDocument();
  const fields: Record<string, unknown> = {};
  for (const id of FOUNDATION_MESSAGE_FIELD_IDS) {
    fields[id] = { value: PRIMITIVES[id] ?? `${id} value`, source: 'Asked', status: 'draft' };
  }
  for (const id of FOUNDATION_MESSAGE_LIST_FIELD_IDS) {
    fields[id] = { value: [], source: 'Needs input', status: 'tbd' };
  }
  return {
    contract: 'messaging-document-output/v1',
    kind: 'messaging-document',
    project: 'testorbit',
    project_name: 'TestOrbit',
    version: 1,
    mode: 'generate',
    status: 'Draft — from your documents',
    document_markdown: documentMarkdown,
    content_sha256: createHash('sha256').update(documentMarkdown, 'utf8').digest('hex'),
    fields,
    brand_seed: {
      project_name: 'TestOrbit',
      logo: { light: 'https://testorbit.example.org/logo.svg', dark: null },
      palette: null,
      fonts: null,
      _source: { logo: 'site header', palette: 'none — LF default', fonts: 'none — LF default' },
    },
    inputs_record: { documents: [], sources: [], lfx_records: [], answers: [] },
    intake: { mode: 'form', shape: 'answers', completed_at: '2026-10-15T10:00:00Z' },
    revision: null,
    capabilities: { web_fetch: false, lfx_mcp: false },
    generated_at: '2026-10-15T10:00:00Z',
    agent: { identifier: 'linux-foundation~foundation-message', agent_version: '2.0.0', prompt_manifest_sha256: 'b'.repeat(64) },
    ...overrides,
  };
}

/** Wraps an envelope the way the authoritative finalize tool result rides raw events. */
const toolResultPayload = (envelope: Record<string, unknown>): string =>
  JSON.stringify({ type: 'llm_done', content: { envelope_json: JSON.stringify(envelope) } });

const read = (text: string | null) => ({ text, title: null, truncated: false, ...(text === null && { reason: 'fetch-failed' }) });

describe('FoundationMessageService.startGeneration', () => {
  let service: FoundationMessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FoundationMessageService();
    guildMocks.createSession.mockResolvedValue('session-1');
    readmeMocks.fetchReadme.mockResolvedValue({ readme: '# TestOrbit readme', outcome: { fetched: true, source: 'repository' } });
    sourceTextMocks.readLink.mockImplementation(async (_req: Request, url: string) =>
      read(url === 'https://testorbit.example.org' ? '# TestOrbit\n\n![TestOrbit logo](https://testorbit.example.org/logo.svg)' : null)
    );
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

  it('reads every source to text and sends the rendered intake form', async () => {
    const start = await service.startGeneration(req, answers(), [], 'foundation-message');

    expect(start).toEqual({ sessionId: 'session-1', readme: { fetched: true, source: 'repository' } });
    expect(readmeMocks.fetchReadme).toHaveBeenCalledWith(req, 'https://github.com/example-org/testorbit');
    // "none" is never fetched; every other source is.
    expect(sourceTextMocks.readLink.mock.calls.map((call) => call[1])).toEqual(['https://testorbit.example.org', 'https://press.example.org/testorbit']);
    const params = sentParams();
    expect(params.handle).toBe('foundation-message');
    expect(params.agentInput).toBeUndefined();
    const message = params.message ?? '';
    expect(message.startsWith('BATCH INTAKE SUBMISSION (Messaging Document — GENERATE)\nFORM SHAPE: ANSWERS')).toBe(true);
    expect(message).toContain(
      'URL: https://testorbit.example.org\nTEXT: read, follows\n# TestOrbit\n\n![TestOrbit logo](https://testorbit.example.org/logo.svg)'
    );
    expect(message).toContain('TEXT: read, follows\n# TestOrbit readme\n--- END SOURCE readme ---');
    // A source LFX One could not fetch is sent as not read — never guessed.
    expect(message).toContain('URL: https://press.example.org/testorbit\nTEXT: not read (LFX One could not fetch it — never guess what it says)');
    expect(message).toContain('--- SOURCE brand_page: an existing brand page or guidelines, if any ---\nURL: none\nTEXT: none (the requester gave no URL)');
    expect(message).toContain('STEP 1 ANSWERS: 10 of 10 answered on the form');
  });

  it('re-reads document links itself and passes uploaded files through', async () => {
    await service.startGeneration(
      req,
      answers(),
      [
        { kind: 'link', title: 'Positioning note', url: 'https://wiki.example.org/note' },
        { kind: 'file', title: 'brand.md', text: 'Brand guide text.' },
      ],
      'foundation-message'
    );

    expect(sourceTextMocks.readLink).toHaveBeenCalledWith(req, 'https://wiki.example.org/note', 60000, expect.any(Object));
    // Every source and document of one generate draws on the same parse-time budget.
    const budgets = new Set(sourceTextMocks.readLink.mock.calls.map((call) => call[3]));
    expect(budgets.size).toBe(1);
    const message = sentParams().message ?? '';
    expect(message).toContain('FORM SHAPE: DOCUMENTS WITH ANSWERS');
    expect(message).toContain(
      '--- DOCUMENT 1: Positioning note ---\nURL: https://wiki.example.org/note\nTEXT: not read (only a link was given and LFX One could not read it)'
    );
    expect(message).toContain('--- DOCUMENT 2: brand.md ---\nURL: none\nTEXT: read, follows\nBrand guide text.\n--- END DOCUMENT 2 ---');
  });

  it('fetches no README and reports no README outcome when no GitHub URL was given', async () => {
    const start = await service.startGeneration(req, { ...answers(), github_url: 'none' }, [], 'foundation-message');

    expect(readmeMocks.fetchReadme).not.toHaveBeenCalled();
    expect(start).toEqual({ sessionId: 'session-1' });
    expect(sentParams().message).toContain("LOGO FALLBACK (GitHub organization avatar, last in Paul's logo order): none");
  });

  it('submits the typed form as the structured agent_input when GUILD_STRUCTURED_AGENT_INPUT=true', async () => {
    vi.stubEnv('GUILD_STRUCTURED_AGENT_INPUT', 'true');

    await service.startGeneration(req, answers(), [], 'foundation-message');

    const params = sentParams();
    expect(params.message).toBeUndefined();
    expect(params.agentInput).toMatchObject({
      type: 'messaging_document_intake_form',
      project_name: 'TestOrbit',
      github_url: 'https://github.com/example-org/testorbit',
      readme_text: '# TestOrbit readme',
      press_release_url: 'https://press.example.org/testorbit',
    });
    expect(params.agentInput).not.toHaveProperty('press_release_text');
    expect(params.agentInput).not.toHaveProperty('brand_page_url');
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

  it('returns the validated document with its copy primitives when the envelope passes every gate', async () => {
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope())]);

    const result = await service.getResult(req, 'session-1');

    expect(result.status).toBe('ready');
    expect(result.version).toBe(1);
    expect(result.projectName).toBe('TestOrbit');
    expect(result.documentStatus).toBe('Draft — from your documents');
    expect(result.derivatives).toMatchObject({ summary_25: PRIMITIVES['md.summary_25'], elevator_pitch: PRIMITIVES['md.elevator_pitch'] });
    expect(result.documentMarkdown).toContain('## 7. Message house');
  });

  it('never surfaces an envelope on the previous Message Foundation contract', async () => {
    guildMocks.getRawEventPayloads.mockResolvedValue([toolResultPayload(buildEnvelope({ contract: 'message-foundation-output/v1' }))]);

    expect(await service.getResult(req, 'session-1')).toEqual({ status: 'pending' });
  });

  it('suppresses an envelope whose copy primitive is not verbatim in the hash-verified document (gate F3)', async () => {
    const forged = buildEnvelope();
    (forged['fields'] as Record<string, { value: string }>)['md.summary_25'].value = 'A summary the document never contains.';
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
});

/**
 * Every validated bundle is stored through the SAME persistence contract the
 * Brand Kit has, and recorded as a revision of the project's
 * foundation-message document.
 */
describe('FoundationMessageService persistence', () => {
  const PROJECT_UID = 'proj-uid-1';
  let service: FoundationMessageService;

  beforeEach(() => {
    vi.clearAllMocks();
    documentStoreMocks.recordedSessions.length = 0;
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
    // Recorded as a revision of the project's foundation-message document, keyed by the run's session.
    expect(documentStoreMocks.recordedSessions).toEqual(['session-1']);
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
