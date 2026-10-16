// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same mocking approach as mktg-artifact.service.spec.ts: shared runtime
// modules are re-exported from their real (Angular-free) source files, and the
// object store is an in-memory fake with the create-if-absent, list-by-prefix
// and get semantics every backend serves — so the store's real write, list,
// read, migration and restore paths run end to end against the real shared
// artifact layer.
const store = vi.hoisted(() => ({
  objects: new Map<string, { body: string; metadata: Record<string, string>; lastModified: Date }>(),
  clock: 0,
  failPutsMatching: null as RegExp | null,
}));
const loggerMocks = vi.hoisted(() => ({
  startOperation: vi.fn(() => 0),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));
const projectMocks = vi.hoisted(() => ({ getProjectById: vi.fn() }));

vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-artifact.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document.utils')),
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
}));
vi.mock('./logger.service', () => ({ logger: loggerMocks }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectById = projectMocks.getProjectById;
  },
}));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public async putContentAddressedObject(
      _req: unknown,
      _purpose: string,
      key: string,
      body: Buffer,
      _contentType: string,
      _cacheControl: string,
      metadata?: Record<string, string>
    ): Promise<boolean> {
      if (store.failPutsMatching?.test(key)) {
        throw new Error('store unavailable');
      }
      if (store.objects.has(key)) {
        return false;
      }
      store.clock += 1000;
      store.objects.set(key, { body: body.toString('utf8'), metadata: metadata ?? {}, lastModified: new Date(store.clock) });
      return true;
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
      return [...store.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async getObject(_req: unknown, _purpose: string, key: string): Promise<{ body: string; metadata: Record<string, string> } | null> {
      const object = store.objects.get(key);
      return object ? { body: object.body, metadata: object.metadata } : null;
    }
  },
}));

import { MKTG_ARTIFACT_SPECS, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import type { MktgArtifactEnvelope, MktgDocumentType, MktgReadmeSkipReason, MktgRevisionRecord } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MktgDocumentStoreService } from './mktg-document-store.service';

const req = { path: '/api/mktg-agents/documents' } as unknown as Request;
const PROJECT = 'proj-uid-1';
const SPEC = MKTG_ARTIFACT_SPECS['brand-kit'];
const BRAND_KIT = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'brand-kit') as MktgDocumentType;
const LINKEDIN = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'linkedin-post') as MktgDocumentType;

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function envelope(markdown: string, version = 1): MktgArtifactEnvelope {
  // The agents' envelopes carry more than the persistence layer reads; the sidecar keeps it.
  const full = {
    contract: 'brand-kit-output/v1',
    document_markdown: markdown,
    content_sha256: sha(markdown),
    version,
    intake: { mode: 'form' as const, answers: [{ question_number: 1, answer: 'An answer' }] },
  };
  return full;
}

/** Seed a document stored before revisions existed, at `brand-kit/{project}/{sha}.md`. */
function seedLegacy(markdown: string): string {
  store.clock += 1000;
  const key = `brand-kit/${PROJECT}/${sha(markdown)}.md`;
  store.objects.set(key, { body: markdown, metadata: { version: '2', 'intake-mode': 'form' }, lastModified: new Date(store.clock) });
  return key;
}

function revisionKeys(): string[] {
  return [...store.objects.keys()].filter((key) => key.startsWith('documents/')).sort();
}

function storedRecord(key: string): MktgRevisionRecord {
  return JSON.parse(store.objects.get(key)?.body ?? '{}') as MktgRevisionRecord;
}

describe('MktgDocumentStoreService', () => {
  let service: MktgDocumentStoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    store.objects.clear();
    store.clock = 0;
    store.failPutsMatching = null;
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: true });
    service = new MktgDocumentStoreService();
  });

  describe('persistGeneration', () => {
    it('writes the artifact as before and records it as revision 1 with its bundle, empty comments and an empty deck', async () => {
      const generated = envelope('# Brand Kit\n\nStatus: Draft — for review\n');

      const receipt = await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');

      expect(receipt?.s3_key).toBe(`brand-kit/${PROJECT}/${generated.content_sha256}.md`);
      expect(receipt?.document).toEqual({ agentKey: 'brand-kit', documentId: 'living', revisionId: revisionKeys()[0].split('/').at(-1)?.slice(0, -5) });
      const keys = revisionKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(new RegExp(`^documents/${PROJECT}/brand-kit/living/000001-[0-9a-f]{64}\\.json$`));
      // Content-addressed by the record's own bytes.
      expect(keys[0]).toContain(sha(store.objects.get(keys[0])?.body ?? ''));

      const record = storedRecord(keys[0]);
      expect(record).toMatchObject({
        schema: 'mktg-document-revision/v1',
        project: PROJECT,
        agentKey: 'brand-kit',
        documentId: 'living',
        sequence: 1,
        origin: 'generated',
        restoredFromId: null,
        source: { sessionId: 'session-1', draftVersion: 1, intakeMode: 'form' },
        comments: [],
        deck: { spec: null, link: null },
      });
      expect(record.bundle.markdown).toBe(generated.document_markdown);
      expect(record.bundle.contentSha256).toBe(generated.content_sha256);
      expect(record.bundle.brandFile).toBeNull();
      // No personal identity inside the immutable, content-addressed bytes.
      expect(record).not.toHaveProperty('createdBy');
      // The sidecar is the envelope's structured fields, never the Markdown again.
      expect(record.bundle.sidecar).toMatchObject({ contract: 'brand-kit-output/v1', intake: generated.intake });
      expect(record.bundle.sidecar).not.toHaveProperty('document_markdown');
    });

    it('returns the exact recorded revision with provenance and derivatives, including after another run lands', async () => {
      const generated = { ...envelope('# First\n'), derivatives: { summary: 'Short copy', invalid: 1 } };
      const first = await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Second\n'), PROJECT, 'session-2');
      const location = first?.document;
      expect(location).toBeDefined();
      const read = await service.getRevision(req, PROJECT, BRAND_KIT, location!.documentId, location!.revisionId);
      expect(read?.markdown).toBe('# First\n');
      expect(read?.source?.sessionId).toBe('session-1');
      expect(read?.derivatives).toEqual({ summary: 'Short copy' });
    });

    it('records only a known README-less reason, never arbitrary client text', async () => {
      const request = { ...req, body: { readme: { fetched: false, skipReason: 'no-readme', extra: 'not stored' } } } as Request;
      const generated = { ...envelope('# First\n'), inputs: { readme_provided: false } };
      const receipt = await service.persistGeneration(request, SPEC, generated, PROJECT, 'session-1', { fetched: false, skipReason: 'no-readme' });
      const read = await service.getRevision(req, PROJECT, BRAND_KIT, 'living', receipt!.document!.revisionId);
      expect(read?.source?.readme).toEqual({ fetched: false, skipReason: 'no-readme' });
      const withReadme = { ...req, body: { readme: { fetched: true } } } as Request;
      await service.persistGeneration(withReadme, SPEC, envelope('# Second\n'), PROJECT, 'session-2', { fetched: true });
      expect(storedRecord(revisionKeys()[1]).source.readme).toBeUndefined();
      await service.persistGeneration(
        { ...req, body: { readme: { fetched: false, skipReason: 'invented' } } } as Request,
        SPEC,
        { ...generated, document_markdown: '# Third\n', content_sha256: sha('# Third\n') },
        PROJECT,
        'session-3',
        { fetched: false, skipReason: 'invented' as MktgReadmeSkipReason }
      );
      expect(storedRecord(revisionKeys()[2]).source.readme).toBeUndefined();
      await service.persistGeneration(request, SPEC, envelope('# No explicit outcome\n'), PROJECT, 'session-4');
      expect(storedRecord(revisionKeys()[3]).source.readme).toBeUndefined();
    });

    it('records a generation once, however often the result is polled', async () => {
      const generated = envelope('# Brand Kit\n');

      await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');

      expect(revisionKeys()).toHaveLength(1);
    });

    it('records a newer draft even when it repeats the prior document bytes on the same session', async () => {
      await service.persistGeneration(req, SPEC, envelope('# Unchanged\n', 1), PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Unchanged\n', 2), PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Unchanged\n', 2), PROJECT, 'session-1');
      expect(revisionKeys()).toHaveLength(2);
    });

    it('adds a new latest revision for each new generation of a living document', async () => {
      await service.persistGeneration(req, SPEC, envelope('# First\n'), PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Second\n'), PROJECT, 'session-2');

      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(detail?.revisions.map((revision) => [revision.number, revision.origin, revision.latest])).toEqual([
        [2, 'generated', true],
        [1, 'generated', false],
      ]);
    });

    it('drops the receipt when the revision cannot be written, so the next poll retries', async () => {
      store.failPutsMatching = /^documents\//;

      const receipt = await service.persistGeneration(req, SPEC, envelope('# Brand Kit\n'), PROJECT, 'session-1');

      expect(receipt).toBeNull();
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'mktg_document_store_record',
        expect.stringContaining('Revision write failed'),
        expect.objectContaining({ err: expect.any(Error) })
      );

      store.failPutsMatching = null;
      await expect(service.persistGeneration(req, SPEC, envelope('# Brand Kit\n'), PROJECT, 'session-1')).resolves.not.toBeNull();
      expect(revisionKeys()).toHaveLength(1);
    });

    it('records nothing when the shared artifact layer refused to persist', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });

      await expect(service.persistGeneration(req, SPEC, envelope('# Brand Kit\n'), PROJECT, 'session-1')).resolves.toBeNull();
      expect(store.objects.size).toBe(0);
    });
  });

  describe('documents stored before revisions existed', () => {
    it('shows the pre-revision document as revision 1, Markdown only, without writing anything', async () => {
      const legacyMarkdown = '# Old Brand Kit\n';
      seedLegacy(legacyMarkdown);

      const listed = await service.listDocuments(req, PROJECT);
      const group = listed.groups.find((candidate) => candidate.type.agentKey === 'brand-kit');
      expect(group?.documents).toEqual([
        expect.objectContaining({ documentId: 'living', revisionCount: 1, latestRevisionId: `legacy-${sha(legacyMarkdown)}` }),
      ]);

      const revision = await service.getRevision(req, PROJECT, BRAND_KIT, 'living', `legacy-${sha(legacyMarkdown)}`);
      expect(revision?.markdown).toBe(legacyMarkdown);
      expect(revision?.revision).toMatchObject({ number: 1, origin: 'legacy', latest: true });
      expect(revisionKeys()).toHaveLength(0);
    });

    it('migrates the pre-revision document to a stored revision 1 when the next generation is recorded', async () => {
      const legacyMarkdown = '# Old Brand Kit\n';
      seedLegacy(legacyMarkdown);

      await service.persistGeneration(req, SPEC, envelope('# New Brand Kit\n'), PROJECT, 'session-1');

      const keys = revisionKeys();
      expect(keys).toHaveLength(2);
      const migrated = storedRecord(keys[0]);
      expect(migrated).toMatchObject({ sequence: 1, origin: 'legacy', source: { sessionId: null, draftVersion: 2, intakeMode: 'form' } });
      expect(migrated.bundle).toEqual({ markdown: legacyMarkdown, contentSha256: sha(legacyMarkdown), sidecar: null, brandFile: null });
      expect(storedRecord(keys[1])).toMatchObject({ sequence: 2, origin: 'generated' });

      // The old legacy id still opens the same revision.
      const revision = await service.getRevision(req, PROJECT, BRAND_KIT, 'living', `legacy-${sha(legacyMarkdown)}`);
      expect(revision?.revision).toMatchObject({ number: 1, origin: 'legacy', latest: false });
    });
  });

  describe('restoreRevision', () => {
    it('makes an older revision the latest as a new revision, and dependent agents read it', async () => {
      await service.persistGeneration(req, SPEC, envelope('# First\n'), PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Second\n'), PROJECT, 'session-2');
      const first = (await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[1];

      const restored = await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first?.id as string);

      expect(restored?.revision).toMatchObject({ number: 3, origin: 'restored', restoredFromNumber: 1, latest: true });
      expect(restored?.detail.revisions).toHaveLength(3);
      // Nothing is deleted.
      expect(revisionKeys()).toHaveLength(3);
      const record = storedRecord(revisionKeys()[2]);
      expect(record.bundle.markdown).toBe('# First\n');
      expect(record.comments).toEqual([]);
      expect(record.deck).toEqual({ spec: null, link: null });

      const latest = await service.readLatest(req, SPEC, PROJECT);
      expect(latest?.documentMarkdown).toBe('# First\n');
      expect(latest?.receipt.s3_key).toBe(`brand-kit/${PROJECT}/${sha('# First\n')}.md`);
    });

    it('changes nothing when the chosen revision is already the latest', async () => {
      await service.persistGeneration(req, SPEC, envelope('# Only\n'), PROJECT, 'session-1');
      const only = (await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[0];

      const restored = await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', only?.id as string);

      expect(restored?.revision.number).toBe(1);
      expect(revisionKeys()).toHaveLength(1);
    });

    it('restores a migrated pre-revision document by its legacy id', async () => {
      const legacyMarkdown = '# Old Brand Kit\n';
      seedLegacy(legacyMarkdown);
      await service.persistGeneration(req, SPEC, envelope('# New Brand Kit\n'), PROJECT, 'session-1');

      const restored = await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', `legacy-${sha(legacyMarkdown)}`);

      expect(restored?.revision).toMatchObject({ number: 3, restoredFromNumber: 1 });
      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: legacyMarkdown });
    });

    it('returns null for a revision the document does not have', async () => {
      await service.persistGeneration(req, SPEC, envelope('# Only\n'), PROJECT, 'session-1');

      await expect(service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', `000009-${'a'.repeat(64)}`)).resolves.toBeNull();
    });
  });

  describe('one-off runs', () => {
    it('stores every run as its own document with a single revision that is never updated', async () => {
      await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Post A\n'), 'session-a');
      await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Post A, draft 2\n', 2), 'session-a');
      await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Post B\n'), 'session-b');

      const group = (await service.listDocuments(req, PROJECT)).groups.find((candidate) => candidate.type.agentKey === 'linkedin-post');
      expect(group?.documents).toHaveLength(2);
      expect(group?.documents.every((document) => document.revisionCount === 1 && /^run-[0-9a-f]{24}$/.test(document.documentId))).toBe(true);
    });
  });

  describe('reads', () => {
    it('skips a revision whose bytes do not match its content-addressed key', async () => {
      await service.persistGeneration(req, SPEC, envelope('# First\n'), PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Second\n'), PROJECT, 'session-2');
      const tamperedKey = revisionKeys()[1];
      const tampered = store.objects.get(tamperedKey);
      store.objects.set(tamperedKey, { ...(tampered as { body: string; metadata: Record<string, string>; lastModified: Date }), body: '{"tampered":true}' });

      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');

      expect(detail?.revisions).toHaveLength(1);
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_document_store_read', expect.stringContaining('do not match'), expect.any(Object));
      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: '# First\n' });
    });

    it('serves the pre-revision document to dependent agents until the first revision exists', async () => {
      seedLegacy('# Old Brand Kit\n');

      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: '# Old Brand Kit\n', receipt: { version: 2 } });
    });

    it('lists every document type in order, with empty groups for types that have nothing stored', async () => {
      const listed = await service.listDocuments(req, PROJECT);

      expect(listed.groups.map((group) => [group.type.agentKey, group.documents.length])).toEqual(MKTG_DOCUMENT_TYPES.map((type) => [type.agentKey, 0]));
    });

    it('returns null for a document with nothing stored', async () => {
      await expect(service.getDocument(req, PROJECT, BRAND_KIT, 'living')).resolves.toBeNull();
    });
  });
});
