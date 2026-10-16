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
  reads: [] as string[],
  headReads: [] as string[],
  omitEtag: false,
  activeHeads: 0,
  maxHeads: 0,
  rejectComparisons: false,
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
    public async headObject(_req: unknown, _purpose: string, key: string): Promise<Record<string, string> | null> {
      store.headReads.push(key);
      store.activeHeads++;
      store.maxHeads = Math.max(store.maxHeads, store.activeHeads);
      await Promise.resolve();
      store.activeHeads--;
      return store.objects.get(key)?.metadata ?? null;
    }
    public async putConditionalObject(
      _req: unknown,
      _purpose: string,
      key: string,
      input: { body: Buffer; metadata?: Record<string, string>; ifMatch?: string; ifNoneMatch?: string }
    ): Promise<boolean> {
      if (store.failPutsMatching?.test(key)) throw new Error('store unavailable');
      const previous = store.objects.get(key);
      if (input.ifMatch && store.rejectComparisons) return false;
      if ((input.ifNoneMatch && previous) || (input.ifMatch && (!previous || input.ifMatch !== String(previous.lastModified.getTime())))) return false;
      store.clock += 1000;
      store.objects.set(key, { body: input.body.toString('utf8'), metadata: input.metadata ?? {}, lastModified: new Date(store.clock) });
      return true;
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
      return [...store.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async getObject(_req: unknown, _purpose: string, key: string): Promise<{ body: string; metadata: Record<string, string>; etag?: string } | null> {
      store.reads.push(key);
      const object = store.objects.get(key);
      return object ? { body: object.body, metadata: object.metadata, etag: store.omitEtag ? undefined : String(object.lastModified.getTime()) } : null;
    }
  },
}));

import { MKTG_ARTIFACT_SPECS, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import type { MktgArtifactEnvelope, MktgDocumentType, MktgRevisionRecord } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MktgDocumentStoreService } from './mktg-document-store.service';

const req = {
  path: '/api/mktg-agents/documents',
  oidc: { user: { sub: 'auth0|not-the-lfid', 'https://sso.linuxfoundation.org/claims/username': 'synthetic-writer', name: 'The writer' } },
} as unknown as Request;
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
  return [...store.objects.keys()].filter((key) => key.startsWith('documents/') && /\/[0-9]{6}-[a-f0-9]{64}\.json$/.test(key)).sort();
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
    store.reads = [];
    store.headReads = [];
    store.omitEtag = false;
    store.activeHeads = 0;
    store.maxHeads = 0;
    store.rejectComparisons = false;
    store.failPutsMatching = null;
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: true });
    service = new MktgDocumentStoreService();
  });

  describe('persistGeneration', () => {
    it('writes the artifact as before and records it as revision 1 with its bundle, empty comments and an empty deck', async () => {
      const generated = envelope('# Brand Kit\n\nStatus: Draft — for review\n');

      const receipt = await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');

      expect(receipt?.s3_key).toBe(`brand-kit/${PROJECT}/${generated.content_sha256}.md`);
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

    it('records a generation once, however often the result is polled', async () => {
      const generated = envelope('# Brand Kit\n');

      await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');

      expect(revisionKeys()).toHaveLength(1);
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

  it('commits overlapping polls once, with attribution outside hashed bytes', async () => {
    const generated = envelope('# Concurrent\n');
    await Promise.all([service.persistGeneration(req, SPEC, generated, PROJECT, 'same'), service.persistGeneration(req, SPEC, generated, PROJECT, 'same')]);
    const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(detail?.revisions).toHaveLength(1);
    expect(detail?.revisions[0].author).toEqual({ username: 'synthetic-writer', name: 'The writer' });
    expect(store.objects.get(revisionKeys()[0])?.body).not.toContain('The writer');
  });

  it('keeps both concurrent generations and bounds metadata reads', async () => {
    await Promise.all([
      service.persistGeneration(req, SPEC, envelope('# A'), PROJECT, 'a'),
      service.persistGeneration(req, SPEC, envelope('# B'), PROJECT, 'b'),
    ]);
    const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(detail?.revisions).toHaveLength(2);
    store.reads = [];
    await service.getRevision(req, PROJECT, BRAND_KIT, 'living', detail!.revisions[0].id);
    expect(store.reads.filter((key) => /\/[0-9]{6}-/.test(key))).toHaveLength(1);
    expect(store.maxHeads).toBeLessThanOrEqual(4);
  });

  it('records the actual current base and supports a future comment revision', async () => {
    const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# A'), 'a');
    await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# B'), 'b');
    await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
    const third = await service.recordRevision(req, PROJECT, BRAND_KIT, 'living', {
      createdAt: new Date().toISOString(),
      origin: 'revised',
      restoredFromId: null,
      source: { sessionId: 'c', draftVersion: 1, intakeMode: 'form' },
      bundle: { markdown: '# C', contentSha256: sha('# C'), sidecar: null, brandFile: null },
      comments: [{ anchor: 'A', text: 'Clarify', author: 'opaque-reviewer', createdAt: new Date().toISOString() }],
    });
    expect(third.record.basedOnId).toBe(first.id);
    expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[0]).toMatchObject({
      number: 3,
      basedOnNumber: 1,
      commentCount: 1,
      origin: 'revised',
      latest: true,
    });
  });

  it('never materializes the leftover artifact of a failed save as revision one', async () => {
    store.failPutsMatching = /^documents\//;
    await service.persistGeneration(req, SPEC, envelope('# Failed'), PROJECT, 'failed');
    store.failPutsMatching = null;
    await service.persistGeneration(req, SPEC, envelope('# Later'), PROJECT, 'later');
    expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions).toHaveLength(1);
  });

  it('refuses Make current for a one-off document', async () => {
    const first = await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Post'), 'post');
    await expect(service.restoreRevision(req, PROJECT, LINKEDIN, first.record.documentId, first.id)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('does not show a bundle left behind before its pointer commit', async () => {
    store.failPutsMatching = /current\.json$/;
    await service.persistGeneration(req, SPEC, envelope('# Interrupted'), PROJECT, 'interrupted');
    expect(revisionKeys().length).toBeGreaterThan(0);
    await expect(service.getDocument(req, PROJECT, BRAND_KIT, 'living')).resolves.toBeNull();
    store.failPutsMatching = null;
    await service.persistGeneration(req, SPEC, envelope('# Committed'), PROJECT, 'committed');
    expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions).toHaveLength(1);
  });

  it('does not overwrite a concurrent pointer selection on a failed comparison', async () => {
    const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
    await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Second'), 'second');
    store.rejectComparisons = true;
    await expect(service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first.id)).rejects.toMatchObject({ statusCode: 412 });
    expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[0].latest).toBe(true);
  });

  it('reads historical revisions with no pointer or author without migration', async () => {
    await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
    const second = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Second', 2), 'second');
    store.objects.delete(`documents/${PROJECT}/brand-kit/living/current.json`);
    for (const key of revisionKeys()) {
      const object = store.objects.get(key)!;
      object.metadata = { origin: 'generated', sequence: String(storedRecord(key).sequence) };
    }
    const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(detail?.revisions[0]).toMatchObject({ id: second.id, latest: true, author: null });
    expect(detail?.current).toBeNull();
    await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: '# Second', receipt: { version: 2 } });
    expect(store.objects.has(`documents/${PROJECT}/brand-kit/living/current.json`)).toBe(false);
  });

  it.each(['prefill', 'conversational'] as const)('preserves historical %s provenance, date, status and restored-from number', async (mode) => {
    const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
    const markdown = '# Restored\n\nStatus: Draft — for review\n';
    await service.recordRevision(req, PROJECT, BRAND_KIT, 'living', {
      createdAt: '2025-01-02T12:00:00.000Z',
      origin: 'restored',
      restoredFromId: first.id,
      source: { sessionId: null, draftVersion: 7, intakeMode: mode },
      bundle: { markdown, contentSha256: sha(markdown), sidecar: null, brandFile: null },
    });
    store.objects.delete(`documents/${PROJECT}/brand-kit/living/current.json`);
    for (const key of revisionKeys()) store.objects.get(key)!.metadata = { origin: storedRecord(key).origin, sequence: String(storedRecord(key).sequence) };
    const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(detail?.revisions[0]).toMatchObject({
      createdAt: '2025-01-02T12:00:00.000Z',
      origin: 'restored',
      restoredFromNumber: 1,
      intakeMode: mode,
      draftVersion: 7,
      status: 'Draft — for review',
      author: null,
    });
    const opened = await service.getRevision(req, PROJECT, BRAND_KIT, 'living', detail!.revisions[0].id);
    expect(opened?.revision).toMatchObject({ intakeMode: mode, restoredFromNumber: 1 });
    expect((await service.readLatest(req, SPEC, PROJECT))?.receipt).toMatchObject({ intake_mode: mode, version: 7 });
    expect(store.maxHeads).toBeLessThanOrEqual(4);
  });

  it('reads a single pointer snapshot and one selected new body for dependencies', async () => {
    await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
    store.reads = [];
    store.headReads = [];
    await service.readLatest(req, SPEC, PROJECT);
    expect(store.reads.filter((key) => key.endsWith('current.json'))).toHaveLength(1);
    expect(store.reads.filter((key) => /\/[0-9]{6}-/.test(key))).toHaveLength(1);
    expect(store.headReads).toHaveLength(1);
  });

  it('reads multiple run documents concurrently without multiplying the four-read bound', async () => {
    for (let index = 0; index < 9; index++) await service.recordGeneration(req, LINKEDIN, PROJECT, envelope(`# ${index}`), `run-${index}`);
    const getDocument = service.getDocument.bind(service);
    let active = 0;
    let maximum = 0;
    vi.spyOn(service, 'getDocument').mockImplementation(async (...args) => {
      active++;
      maximum = Math.max(maximum, active);
      try {
        return await getDocument(...args);
      } finally {
        active--;
      }
    });
    const result = await service.listDocuments(req, PROJECT);
    expect(result.groups.find((group) => group.type.agentKey === LINKEDIN.agentKey)?.documents).toHaveLength(9);
    expect(maximum).toBe(4);
    expect(store.maxHeads).toBeLessThanOrEqual(4);
  });

  it('flags a document with a missing current revision without failing the project listing or selecting another revision', async () => {
    await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
    const current = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Second'), 'second');
    store.objects.delete(current.key);
    const listed = await service.listDocuments(req, PROJECT);
    expect(listed.groups.find((group) => group.type.agentKey === BRAND_KIT.agentKey)?.documents).toEqual([]);
    expect(loggerMocks.warning).toHaveBeenCalledWith(
      req,
      'mktg_document_store_list',
      expect.stringContaining('Current revision is missing'),
      expect.any(Object)
    );
    await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toBeNull();
  });

  it('stops legacy metadata reads at the first eligible candidate', async () => {
    seedLegacy('# Old');
    seedLegacy('# New');
    store.headReads = [];
    await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(store.headReads).toHaveLength(1);
  });

  it.each(['invalid-json', 'invalid-record', 'missing-etag'])('raises a typed current-record error for %s', async (fault) => {
    await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
    const key = `documents/${PROJECT}/brand-kit/living/current.json`;
    if (fault === 'missing-etag') store.omitEtag = true;
    else store.objects.get(key)!.body = fault === 'invalid-json' ? 'not json' : '{}';
    await expect(service.getDocument(req, PROJECT, BRAND_KIT, 'living')).rejects.toMatchObject({ statusCode: 500, code: 'MKTG_DOCUMENT_CORRUPT' });
  });

  it('raises a typed error for an unreadable committed run revision', async () => {
    const saved = await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Run'), 'run');
    store.objects.get(saved.key)!.body = '{}';
    await expect(service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Run'), 'run')).rejects.toMatchObject({
      statusCode: 500,
      code: 'MKTG_DOCUMENT_CORRUPT',
    });
  });

  it('refuses authoring without an LFID instead of persisting the Auth0 subject', async () => {
    const unidentified = { oidc: { user: { sub: 'auth0|unlinked', name: 'The writer' } } } as unknown as Request;
    await expect(service.recordGeneration(unidentified, BRAND_KIT, PROJECT, envelope('# New'), 'new')).rejects.toMatchObject({ statusCode: 401 });
    expect(store.objects.size).toBe(0);
  });

  it('persists the effective impersonation target LFID and name, not the operator', async () => {
    const impersonated = {
      ...req,
      impersonationActive: true,
      appSession: { impersonationUser: { username: 'synthetic-target', sub: 'auth0|target', name: 'The target' } },
    } as unknown as Request;
    await service.recordGeneration(impersonated, BRAND_KIT, PROJECT, envelope('# Target'), 'target');
    const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(detail?.revisions[0].author).toEqual({ username: 'synthetic-target', name: 'The target' });
    const current = JSON.parse(store.objects.get(`documents/${PROJECT}/brand-kit/living/current.json`)!.body);
    expect(current.changedBy).toEqual({ username: 'synthetic-target', name: 'The target' });
  });

  it('reads summaries without bodies and limits larger metadata batches', async () => {
    for (let index = 0; index < 9; index++) await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope(`# ${index}`), `session-${index}`);
    store.reads = [];
    await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(store.reads.filter((key) => /\/[0-9]{6}-/.test(key))).toHaveLength(0);
    expect(store.maxHeads).toBe(4);
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
    it('moves only current to an older revision, and dependent agents read it', async () => {
      await service.persistGeneration(req, SPEC, envelope('# First\n'), PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Second\n'), PROJECT, 'session-2');
      const first = (await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[1];

      store.reads = [];
      const restored = await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first?.id as string);
      expect(store.reads.filter((key) => key.endsWith('current.json'))).toHaveLength(1);

      expect(restored?.revision).toMatchObject({ number: 1, origin: 'generated', latest: true });
      expect(restored?.detail.revisions).toHaveLength(2);
      expect(revisionKeys()).toHaveLength(2);
      const current = JSON.parse(store.objects.get(`documents/${PROJECT}/brand-kit/living/current.json`)!.body);
      expect(current).toMatchObject({ revisionId: first!.id, changedBy: { username: 'synthetic-writer', name: 'The writer' }, changedAt: expect.any(String) });
      expect(restored?.detail.current).toEqual({ revisionId: current.revisionId, changedAt: current.changedAt, changedBy: current.changedBy });
      expect(restored?.detail.current).not.toHaveProperty('revisionIds');

      const latest = await service.readLatest(req, SPEC, PROJECT);
      expect(latest?.documentMarkdown).toBe('# First\n');
      expect(latest?.receipt.s3_key).toBe(`brand-kit/${PROJECT}/${sha('# First\n')}.md`);
    });

    it('exposes selection attribution separately from revision authorship and preserves it on a no-op', async () => {
      const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Second'), 'second');
      const selector = {
        ...req,
        oidc: { user: { 'https://sso.linuxfoundation.org/claims/username': 'synthetic-selector', name: 'The selector' } },
      } as unknown as Request;
      const selected = await service.restoreRevision(selector, PROJECT, BRAND_KIT, 'living', first.id);
      const opened = await service.getRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      expect(opened?.revision.author).toEqual({ username: 'synthetic-writer', name: 'The writer' });
      expect(opened?.current).toEqual(selected?.detail.current);
      expect(opened?.current).toMatchObject({
        revisionId: first.id,
        changedAt: expect.any(String),
        changedBy: { username: 'synthetic-selector', name: 'The selector' },
      });
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.current).toEqual(opened?.current);
      const noOp = await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      expect(noOp?.detail.current).toEqual(opened?.current);
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

      expect(restored?.revision).toMatchObject({ number: 1, latest: true });
      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: legacyMarkdown });
    });

    it('returns null for a revision the document does not have', async () => {
      await service.persistGeneration(req, SPEC, envelope('# Only\n'), PROJECT, 'session-1');

      await expect(service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', `000009-${'a'.repeat(64)}`)).resolves.toBeNull();
    });
  });

  describe('one-off runs', () => {
    it('publishes exactly one revision when result polls overlap', async () => {
      const generated = envelope('# One run');
      const [first, second] = await Promise.all([
        service.recordGeneration(req, LINKEDIN, PROJECT, generated, 'overlap'),
        service.recordGeneration(req, LINKEDIN, PROJECT, generated, 'overlap'),
      ]);
      expect(first.id).toBe(second.id);
      expect((await service.getDocument(req, PROJECT, LINKEDIN, first.record.documentId))?.revisions).toHaveLength(1);
    });
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

      // Metadata listings do not download or validate bodies. Opening validates
      // exactly that body, and a corrupted current never silently serves another.
      expect(detail?.revisions).toHaveLength(2);
      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toBeNull();
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_document_store_read', expect.stringContaining('do not match'), expect.any(Object));
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
