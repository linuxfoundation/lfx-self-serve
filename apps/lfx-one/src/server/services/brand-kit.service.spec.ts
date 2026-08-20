// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors weekly-brief.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired
// into this app's vitest config with Angular-free resolution, so shared runtime
// collaborators are mocked — except the pure brand-kit utils, which are re-exported
// through the mock from their real (Angular-free) source module so the spec
// exercises the real validation/extraction logic.
const guildMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getRawEventPayloads: vi.fn(),
}));
const objectStoreMocks = vi.hoisted(() => ({
  putObjectIfAbsent: vi.fn(),
  listObjects: vi.fn(),
  getObject: vi.fn(),
}));
const loggerMocks = vi.hoisted(() => ({
  startOperation: vi.fn(() => 0),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({
  getProjectById: vi.fn(),
}));

vi.mock('@lfx-one/shared/utils', async () => {
  const utils = await vi.importActual('../../../../../packages/shared/src/utils/brand-kit.utils');
  return utils;
});
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/brand-kit.constants');
  return constants;
});
vi.mock('./guild.service', () => ({
  GuildService: class {
    public createSession = guildMocks.createSession;
    public getRawEventPayloads = guildMocks.getRawEventPayloads;
  },
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public putObjectIfAbsent = objectStoreMocks.putObjectIfAbsent;
    public listObjects = objectStoreMocks.listObjects;
    public getObject = objectStoreMocks.getObject;
  },
}));
vi.mock('./logger.service', () => ({
  logger: loggerMocks,
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));

import type { Request } from 'express';

import { BrandKitService } from './brand-kit.service';

const req = { path: '/api/mktg-agents/brand-kit/result' } as unknown as Request;

const REQUIRED_HEADINGS = [
  '## How to Use This Document',
  '## 1. Project Definition',
  '## 2. Positioning',
  '## 3. Brand Personality & Voice',
  '## 4. Primary Audiences & Messaging',
  '## 5. Key Brand Strengths',
  '## 6. Competitive Differentiation & Guardrails',
  '## 7. Visual Identity',
  '## 8. Tagline Options',
  '## 9. Channel Quick Reference',
  '## Appendix A: Document Architecture',
  '## Appendix B: Source Intake',
];

function buildDocument(): string {
  const filler = 'Synthetic fixture prose for the Brand Kit structural gate. '.repeat(4);
  const sections = ['# TestOrbit Brand Kit', ''];
  for (const heading of REQUIRED_HEADINGS) {
    sections.push(heading, '', filler, '');
  }
  return sections.join('\n');
}

function buildEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const documentMarkdown = (overrides['document_markdown'] as string) ?? buildDocument();
  return {
    contract: 'brand-kit-output/v1',
    kind: 'brand-kit',
    project: 'testorbit',
    project_name: 'TestOrbit',
    version: 1,
    document_markdown: documentMarkdown,
    content_sha256: createHash('sha256').update(documentMarkdown, 'utf8').digest('hex'),
    intake: {
      mode: 'form',
      completed_at: '2026-08-07T00:00:00Z',
      answers: Array.from({ length: 7 }, (_, i) => ({ question_number: i + 1, question: `Q${i + 1}?`, answer: `A${i + 1}` })),
    },
    ...overrides,
  };
}

/** The run's LFX project uid — the storage partition, resolved server-side. */
const PROJECT_UID = 'proj-uid-1';

describe('BrandKitService', () => {
  let service: BrandKitService;

  beforeEach(() => {
    vi.clearAllMocks();
    objectStoreMocks.putObjectIfAbsent.mockResolvedValue(true);
    // Default: the caller holds the writer grant on the run's project.
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT_UID, slug: 'testorbit', writer: true });
    service = new BrandKitService();
  });

  describe('startGeneration', () => {
    it('renders the batch-intake message and creates the session with the catalog handle', async () => {
      guildMocks.createSession.mockResolvedValue('session-1');
      const answers = {
        project_name: 'TestOrbit',
        github_url: 'https://github.com/test/orbit',
        one_line_description: 'A test project',
        primary_audience: 'Engineers',
        voice_adjectives: 'clear, bold, open',
        constraints: 'none',
        reference_brands: 'Kubernetes',
      };

      const sessionId = await service.startGeneration(req, answers, 'brand-kit');

      expect(sessionId).toBe('session-1');
      expect(guildMocks.createSession).toHaveBeenCalledOnce();
      const [, params] = guildMocks.createSession.mock.calls[0];
      expect(params.handle).toBe('brand-kit');
      expect(params.message).toContain('BATCH INTAKE SUBMISSION');
      expect(params.message).toContain('A1. TestOrbit');
      expect(params.message).toContain('A7. Kubernetes');
    });
  });

  describe('getResult', () => {
    it('returns pending when no envelope is present in the events — and resolves no project', async () => {
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'runtime_start' })]);

      await expect(service.getResult(req, 's', PROJECT_UID)).resolves.toEqual({ status: 'pending' });
      expect(objectStoreMocks.putObjectIfAbsent).not.toHaveBeenCalled();
      // A pending poll must cost no upstream lookups — the entitlement check
      // runs only when there is something to persist.
      expect(projectMocks.getProjectById).not.toHaveBeenCalled();
    });

    it('returns ready with the validated document from a tool-result envelope', async () => {
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: { envelope_json: JSON.stringify(envelope) } })]);

      const result = await service.getResult(req, 's', PROJECT_UID);

      expect(result.status).toBe('ready');
      expect(result.documentMarkdown).toBe(envelope['document_markdown']);
      expect(result.project).toBe('testorbit');
      expect(result.projectName).toBe('TestOrbit');
      expect(result.version).toBe(1);
      expect(result.intakeMode).toBe('form');
    });

    it('persists the ready document under the SERVER-resolved project partition and returns the receipt', async () => {
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: { envelope_json: JSON.stringify(envelope) } })]);

      const result = await service.getResult(req, 's', PROJECT_UID);

      // The partition is the resolved LFX project uid — NEVER the envelope's
      // own `project` slug ('testorbit'), which the read path never lists.
      const expectedKey = `brand-kit/${PROJECT_UID}/${envelope['content_sha256']}.md`;
      expect(projectMocks.getProjectById).toHaveBeenCalledWith(req, PROJECT_UID, true);
      expect(objectStoreMocks.putObjectIfAbsent).toHaveBeenCalledOnce();
      const [, purpose, key, body, contentType, cacheControl, metadata] = objectStoreMocks.putObjectIfAbsent.mock.calls[0];
      expect(purpose).toBe('marketing-os-artifacts');
      expect(key).toBe(expectedKey);
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('utf8')).toBe(envelope['document_markdown']);
      expect(contentType).toBe('text/markdown; charset=utf-8');
      expect(cacheControl).toBe('private');
      // Receipt fields ride as object metadata so the stored-document read
      // path can rebuild the receipt without re-parsing the envelope.
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
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: envelope })]);

      const result = await service.getResult(req, 's', PROJECT_UID);

      expect(objectStoreMocks.putObjectIfAbsent).not.toHaveBeenCalled();
      // The document was already validated for its creator — they still get it.
      expect(result.status).toBe('ready');
      expect(result.persistence).toBeUndefined();
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'brand_kit_persist', expect.stringContaining('writer grant'), expect.any(Object));
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });

    it('does not persist a run with no project scope — a document can only land in a project it belongs to', async () => {
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: envelope })]);

      const result = await service.getResult(req, 's');

      expect(projectMocks.getProjectById).not.toHaveBeenCalled();
      expect(objectStoreMocks.putObjectIfAbsent).not.toHaveBeenCalled();
      expect(result.status).toBe('ready');
      expect(result.persistence).toBeUndefined();
    });

    it('degrades an unresolvable project to no receipt at WARN, document intact', async () => {
      projectMocks.getProjectById.mockRejectedValue(new Error('project service unavailable'));
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: envelope })]);

      const result = await service.getResult(req, 's', PROJECT_UID);

      expect(objectStoreMocks.putObjectIfAbsent).not.toHaveBeenCalled();
      expect(result.status).toBe('ready');
      expect(result.persistence).toBeUndefined();
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });

    it('degrades gracefully when persistence fails: ready without a receipt, document intact', async () => {
      objectStoreMocks.putObjectIfAbsent.mockRejectedValue(new Error('storage down'));
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: envelope })]);

      const result = await service.getResult(req, 's', PROJECT_UID);

      expect(result.status).toBe('ready');
      expect(result.documentMarkdown).toBe(envelope['document_markdown']);
      expect(result.persistence).toBeUndefined();
    });

    it('logs a persistence failure at WARN (graceful degradation), never ERROR', async () => {
      objectStoreMocks.putObjectIfAbsent.mockRejectedValue(new Error('storage down'));
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: envelope })]);

      await service.getResult(req, 's', PROJECT_UID);

      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'brand_kit_persist', expect.stringContaining('Object-store write failed'), expect.any(Object));
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });

    it('suppresses an envelope whose content_sha256 does not match the document bytes', async () => {
      const tampered = buildEnvelope({ content_sha256: 'a'.repeat(64) });
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: tampered })]);

      await expect(service.getResult(req, 's')).resolves.toEqual({ status: 'pending' });
    });

    it('falls back to an older hash-valid envelope when a newer candidate fails the sha recompute', async () => {
      const v1 = buildEnvelope();
      const v2Doc = `${buildDocument()}\nRevised.`;
      const tamperedV2 = buildEnvelope({ version: 2, document_markdown: v2Doc, content_sha256: 'a'.repeat(64) });
      guildMocks.getRawEventPayloads.mockResolvedValue([
        JSON.stringify({ type: 'llm_done', content: v1 }),
        JSON.stringify({ type: 'llm_done', content: tamperedV2 }),
      ]);

      const result = await service.getResult(req, 's');

      expect(result.status).toBe('ready');
      expect(result.version).toBe(1);
    });

    it('prefers the highest version among valid envelopes regardless of event order', async () => {
      const v2Doc = `${buildDocument()}\nRevised.`;
      const v1 = buildEnvelope();
      const v2 = buildEnvelope({ version: 2, document_markdown: v2Doc, content_sha256: createHash('sha256').update(v2Doc, 'utf8').digest('hex') });
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: v2 }), JSON.stringify({ type: 'llm_done', content: v1 })]);

      const result = await service.getResult(req, 's');

      expect(result.status).toBe('ready');
      expect(result.version).toBe(2);
    });

    it('ignores schema-invalid candidates (abridged __submit__ output)', async () => {
      const abridged = { contract: 'brand-kit-output/v1', kind: 'brand-kit', project: 'testorbit', version: 1, document_markdown: 'too short' };
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'runtime_done', content: abridged })]);

      await expect(service.getResult(req, 's')).resolves.toEqual({ status: 'pending' });
    });
  });

  describe('getStoredBrandKit', () => {
    const doc = 'Stored Brand Kit document body';
    const docSha = createHash('sha256').update(doc, 'utf8').digest('hex');
    const key = `brand-kit/${PROJECT_UID}/${docSha}.md`;

    it('returns null without listing when the partition is not a single safe key segment', async () => {
      await expect(service.getStoredBrandKit(req, '../escape')).resolves.toBeNull();
      expect(objectStoreMocks.listObjects).not.toHaveBeenCalled();
    });

    it('returns null when the partition holds no objects', async () => {
      objectStoreMocks.listObjects.mockResolvedValue([]);

      await expect(service.getStoredBrandKit(req, PROJECT_UID)).resolves.toBeNull();
      expect(objectStoreMocks.listObjects).toHaveBeenCalledWith(req, 'marketing-os-artifacts', `brand-kit/${PROJECT_UID}/`);
    });

    it('returns the newest content-addressed object with its receipt rebuilt from metadata', async () => {
      const olderDoc = 'Older stored document';
      const olderSha = createHash('sha256').update(olderDoc, 'utf8').digest('hex');
      const olderKey = `brand-kit/${PROJECT_UID}/${olderSha}.md`;
      objectStoreMocks.listObjects.mockResolvedValue([
        { key: olderKey, lastModified: new Date('2026-08-01T00:00:00Z') },
        { key, lastModified: new Date('2026-08-15T00:00:00Z') },
        // Non-document keys in the partition are ignored, whatever their date.
        { key: `brand-kit/${PROJECT_UID}/notes.txt`, lastModified: new Date('2026-08-19T00:00:00Z') },
      ]);
      objectStoreMocks.getObject.mockResolvedValue({ body: doc, metadata: { version: '3', 'intake-mode': 'conversational' } });

      const stored = await service.getStoredBrandKit(req, PROJECT_UID);

      expect(objectStoreMocks.getObject).toHaveBeenCalledOnce();
      expect(objectStoreMocks.getObject).toHaveBeenCalledWith(req, 'marketing-os-artifacts', key);
      expect(stored).toEqual({
        documentMarkdown: doc,
        receipt: { s3_key: key, content_sha256: docSha, project: PROJECT_UID, version: 3, intake_mode: 'conversational' },
        storedAt: '2026-08-15T00:00:00.000Z',
      });
    });

    it('defaults version/intake_mode for objects persisted before metadata was written', async () => {
      objectStoreMocks.listObjects.mockResolvedValue([{ key, lastModified: new Date('2026-08-15T00:00:00Z') }]);
      objectStoreMocks.getObject.mockResolvedValue({ body: doc, metadata: {} });

      const stored = await service.getStoredBrandKit(req, PROJECT_UID);

      expect(stored?.receipt.version).toBe(1);
      expect(stored?.receipt.intake_mode).toBe('form');
    });

    it('skips an object whose bytes do not hash to its content-addressed key and serves the next candidate', async () => {
      const tamperedKey = `brand-kit/${PROJECT_UID}/${'a'.repeat(64)}.md`;
      objectStoreMocks.listObjects.mockResolvedValue([
        { key: tamperedKey, lastModified: new Date('2026-08-16T00:00:00Z') },
        { key, lastModified: new Date('2026-08-15T00:00:00Z') },
      ]);
      objectStoreMocks.getObject.mockResolvedValueOnce({ body: 'tampered bytes', metadata: { version: '9', 'intake-mode': 'form' } });
      objectStoreMocks.getObject.mockResolvedValueOnce({ body: doc, metadata: { version: '2', 'intake-mode': 'form' } });

      const stored = await service.getStoredBrandKit(req, PROJECT_UID);

      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'brand_kit_stored', expect.stringContaining('do not match'), expect.any(Object));
      expect(stored?.receipt.content_sha256).toBe(docSha);
      expect(stored?.receipt.version).toBe(2);
    });

    it('lists the exact partition the write path wrote to — a persisted kit is never invisible to its project', async () => {
      const envelope = buildEnvelope();
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'llm_done', content: envelope })]);
      const written = await service.getResult(req, 's', PROJECT_UID);
      const writtenKey = written.persistence?.s3_key as string;

      objectStoreMocks.listObjects.mockResolvedValue([{ key: writtenKey, lastModified: new Date('2026-08-20T00:00:00Z') }]);
      objectStoreMocks.getObject.mockResolvedValue({ body: envelope['document_markdown'], metadata: { version: '1', 'intake-mode': 'form' } });

      const stored = await service.getStoredBrandKit(req, PROJECT_UID);

      const [, , listedPrefix] = objectStoreMocks.listObjects.mock.calls[0];
      expect(writtenKey.startsWith(listedPrefix)).toBe(true);
      expect(stored?.receipt.s3_key).toBe(writtenKey);
    });

    it('degrades a storage failure to null at WARN (graceful degradation), never ERROR', async () => {
      objectStoreMocks.listObjects.mockRejectedValue(new Error('bucket unreachable'));

      await expect(service.getStoredBrandKit(req, PROJECT_UID)).resolves.toBeNull();
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'brand_kit_stored', expect.stringContaining('Object-store read failed'), expect.any(Object));
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });
  });
});
