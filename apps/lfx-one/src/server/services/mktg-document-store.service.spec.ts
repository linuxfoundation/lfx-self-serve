// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';
import { buildMktgRunDocumentId } from '../utils/mktg-document-store.util';
import { member360Fixture } from '../../../e2e/fixtures/mock-data/member-360.mock';

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
  conditionalWrites: [] as string[],
  reads: [] as string[],
  headReads: [] as string[],
  omitEtag: false,
  activeHeads: 0,
  maxHeads: 0,
  rejectComparisons: false,
  onRejectedComparison: null as (() => Promise<void>) | null,
  failPutsMatching: null as RegExp | null,
  failListsMatching: null as RegExp | null,
  failGetsMatching: null as RegExp | null,
  missingBodyKey: null as string | null,
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
const directoryMocks = vi.hoisted(() => ({ getUserInfo: vi.fn() }));
vi.mock('./user.service', () => ({
  UserService: class {
    public getUserInfo = directoryMocks.getUserInfo;
  },
}));

vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-artifact.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/boilerplates.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-rebuild.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/linkedin-post-presentation.utils')),
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/boilerplates.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-rebuild.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-kit.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-asset.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-run.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/linkedin-post.constants')),
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
      store.conditionalWrites.push(key);
      const previous = store.objects.get(key);
      if (input.ifMatch && store.rejectComparisons) {
        await store.onRejectedComparison?.();
        return false;
      }
      if ((input.ifNoneMatch && previous) || (input.ifMatch && (!previous || input.ifMatch !== String(previous.lastModified.getTime())))) return false;
      store.clock += 1000;
      store.objects.set(key, { body: input.body.toString('utf8'), metadata: input.metadata ?? {}, lastModified: new Date(store.clock) });
      return true;
    }
    public async putPrivateObjectIfAbsent(
      _req: unknown,
      _purpose: string,
      key: string,
      input: { body: Buffer; metadata: Record<string, string> }
    ): Promise<boolean> {
      if (store.objects.has(key)) return false;
      store.objects.set(key, { body: input.body.toString(), metadata: input.metadata, lastModified: new Date() });
      return true;
    }
    public async putMutableObject(_req: unknown, _purpose: string, key: string, input: { body: Buffer; metadata: Record<string, string> }): Promise<void> {
      store.objects.set(key, { body: input.body.toString(), metadata: input.metadata, lastModified: new Date() });
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
      if (store.failListsMatching?.test(prefix)) {
        throw new Error('store unavailable');
      }
      return [...store.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async getObject(_req: unknown, _purpose: string, key: string): Promise<{ body: string; metadata: Record<string, string>; etag?: string } | null> {
      if (store.failGetsMatching?.test(key)) throw new Error('store unavailable');
      store.reads.push(key);
      if (key === store.missingBodyKey) return null;
      const object = store.objects.get(key);
      return object ? { body: object.body, metadata: object.metadata, etag: store.omitEtag ? undefined : String(object.lastModified.getTime()) } : null;
    }
  },
}));

import { MKTG_ARTIFACT_SPECS, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import type {
  MktgArtifactEnvelope,
  MktgArtifactJsonEnvelope,
  MktgDocumentType,
  MktgRevisionRecord,
  MktgRevisionRecordFields,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError, ResourceNotFoundError } from '../errors';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ObjectStoreService } from './object-store.service';
import { BoilerplatesService } from './boilerplates.service';
import { GuildService } from './guild.service';

const req = {
  path: '/api/mktg-agents/documents',
  oidc: { user: { sub: 'auth0|not-the-lfid', 'https://sso.linuxfoundation.org/claims/username': 'synthetic-writer', name: 'The writer' } },
} as unknown as Request;
const PROJECT = 'proj-uid-1';
const SPEC = MKTG_ARTIFACT_SPECS['brand-kit'];
const FRAMEWORK_SPEC = MKTG_ARTIFACT_SPECS['foundation-message'];
const BRAND_KIT = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'brand-kit') as MktgDocumentType;
const FRAMEWORK = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'foundation-message') as MktgDocumentType;
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

/** A Messaging Framework envelope as the store takes it: the JSON content, its sha over `JSON.stringify(content)`, and the rest as the sidecar. */
function jsonEnvelope(tagline: string, version = 1): MktgArtifactJsonEnvelope {
  const content = { mf: { tagline }, icp: [], mh: { line: tagline }, nums: [['1', 'one']] };
  return {
    contract: 'messaging-framework-output/v1',
    content,
    content_sha256: sha(JSON.stringify(content)),
    version,
    mode: 'draft',
    report: { sources_read: [], sources_failed: [], gaps: ['No member count.'], notes: '' },
    intake: { mode: 'form' as const },
  } as MktgArtifactJsonEnvelope;
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

function storedObject(key: string) {
  const object = store.objects.get(key);
  if (!object) throw new Error('Expected synthetic object to exist');
  return object;
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
    store.conditionalWrites = [];
    store.reads = [];
    store.headReads = [];
    store.omitEtag = false;
    store.activeHeads = 0;
    store.maxHeads = 0;
    store.rejectComparisons = false;
    store.onRejectedComparison = null;
    store.failPutsMatching = null;
    store.failListsMatching = null;
    store.failGetsMatching = null;
    store.missingBodyKey = null;
    directoryMocks.getUserInfo.mockImplementation(async (_req: Request, userId: string) => ({
      success: true,
      data: { name: userId === 'auth0|selector' ? 'The selector' : 'The writer' },
    }));
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: true });
    service = new MktgDocumentStoreService();
  });

  it.each(['valid', 'hash', 'schema'])('projects only verified Member 360 sidecars without losing current metadata (%s)', async (mode) => {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'member-360');
    if (!type) throw new Error('Missing synthetic Member 360 type');
    const member360 = member360Fixture();
    if (mode === 'hash') member360.content_sha256 = '0'.repeat(64);
    const generated = { ...envelope('# Member 360'), member360: mode === 'schema' ? { ...member360, kind: 'invalid' } : member360 };
    const saved = await service.recordGeneration(req, type, PROJECT, generated, 'member-run');
    const view = await service.getRevision(req, PROJECT, type, saved.record.documentId, saved.id);
    expect(view?.current?.revisionId).toBe(saved.id);
    expect(view?.revision.approval).toBeNull();
    expect(view?.member360).toEqual(mode === 'valid' ? member360 : undefined);
    expect(view?.sidecar?.['member360']).toEqual(mode === 'valid' ? member360 : undefined);
  });

  it.each([false, true])('fails strict Member 360 listing on an unreadable newest run (older readable=%s)', async (older) => {
    const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'member-360');
    if (!type) throw new Error('Missing synthetic Member 360 type');
    if (older) await service.recordGeneration(req, type, PROJECT, envelope('# Older'), 'older');
    const newest = await service.recordGeneration(req, type, PROJECT, envelope('# Newest'), 'newest');
    const original = service.getDocument.bind(service);
    const read = vi.spyOn(service, 'getDocument');
    read.mockImplementation((...args) => {
      if (args[3] === newest.record.documentId) return Promise.reject(new MicroserviceError('Unavailable', 503, 'STORE_UNAVAILABLE'));
      return original(...args);
    });
    await expect(service.listDocuments(req, PROJECT, 'member-360')).rejects.toMatchObject({ statusCode: 503 });
    read.mockRestore();
  });

  describe('captured framework provenance', () => {
    async function approvedFramework() {
      const generated = jsonEnvelope('Synthetic framework');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, generated, PROJECT, 'framework-1');
      await approveStored(FRAMEWORK, 1);
      return { generated, ref: await service.captureFramework(req, PROJECT, generated.content) };
    }

    it('starts a non-writer run with unknown provenance without writing any store object', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });
      const start = vi.spyOn(GuildService.prototype, 'createSession').mockResolvedValue('synthetic-session');
      const answers = { project_name: 'Synthetic', messaging_framework: JSON.stringify(jsonEnvelope('Synthetic').content) };
      try {
        await expect(new BoilerplatesService().startGeneration(req, answers, PROJECT, 'boilerplates')).resolves.toBe('synthetic-session');
        expect(store.objects.size).toBe(0);
        expect(store.conditionalWrites).toEqual([]);
        expect(projectMocks.getProjectById).toHaveBeenCalledTimes(1);
      } finally {
        start.mockRestore();
      }
    });

    it.each([false, true])('rejects an expected-framework start if the second writable lookup is unavailable (reject=%s)', async (reject) => {
      const { generated, ref } = await approvedFramework();
      if (!ref) throw new Error('Expected synthetic approved input');
      projectMocks.getProjectById.mockReset().mockResolvedValueOnce({ uid: PROJECT, writer: true });
      if (reject) projectMocks.getProjectById.mockRejectedValueOnce(new Error('Project lookup unavailable'));
      else projectMocks.getProjectById.mockResolvedValueOnce({ uid: PROJECT, writer: false });
      const start = vi.spyOn(GuildService.prototype, 'createSession').mockResolvedValue('synthetic-session');
      try {
        await expect(
          new BoilerplatesService().startGeneration(
            req,
            { project_name: 'Synthetic', messaging_framework: JSON.stringify(generated.content) },
            PROJECT,
            'boilerplates',
            ref
          )
        ).rejects.toMatchObject({ statusCode: 503, code: 'MKTG_PROVENANCE_UNAVAILABLE' });
        expect([...store.objects.keys()].filter((key) => key.startsWith('generation-provenance/'))).toEqual([]);
      } finally {
        start.mockRestore();
      }
    });
    it('refuses a known framework capture without a writable partition', async () => {
      const { ref } = await approvedFramework();
      if (!ref) throw new Error('Expected synthetic approved input');
      await expect(service.rememberGenerationFramework(req, 'brand-kit', undefined, 'session', ref)).rejects.toMatchObject({
        statusCode: 503,
        code: 'MKTG_PROVENANCE_UNAVAILABLE',
      });
    });

    it('captures approved input identity only for exact content and authorized project', async () => {
      const { generated, ref } = await approvedFramework();
      expect(ref).toMatchObject({ agentKey: 'foundation-message', revisionNumber: 1, contentSha256: generated.content_sha256 });
      expect(await service.captureFramework(req, PROJECT, { mf: { tagline: 'different' } })).toBeNull();
      expect(await service.captureFramework(req, undefined, generated.content)).toBeNull();
      projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });
      expect(await service.captureFramework(req, PROJECT, generated.content)).toBeNull();
      if (!ref) throw new Error('Expected synthetic approved input');
      await expect(service.captureFramework(req, PROJECT, generated.content, ref)).rejects.toThrow('could not be verified');
    });

    it.each([/current\.json$/, /\/[0-9]{6}-[a-f0-9]{64}\.json$/])(
      'keeps run-page provenance unknown on read failure but fails a rebuild capture',
      async (failure) => {
        const { generated, ref } = await approvedFramework();
        if (!ref) throw new Error('Expected synthetic approved input');
        store.failGetsMatching = failure;
        expect(await service.captureFramework(req, PROJECT, generated.content)).toBeNull();
        expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_generation_provenance', expect.any(String), expect.objectContaining({ project: PROJECT }));
        await expect(service.captureFramework(req, PROJECT, generated.content, ref)).rejects.toThrow();
      }
    );

    it('does not claim a Draft framework as provenance', async () => {
      const generated = jsonEnvelope('Draft only');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, generated, PROJECT, 'framework-1');
      expect(await service.captureFramework(req, PROJECT, generated.content)).toBeNull();
    });

    it('refuses a changed chain selector even when a different approved revision has identical content', async () => {
      const { generated, ref } = await approvedFramework();
      if (!ref) throw new Error('Expected synthetic approved input');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, generated, PROJECT, 'framework-2');
      await approveStored(FRAMEWORK, 2);
      await expect(service.captureFramework(req, PROJECT, generated.content, ref)).rejects.toThrow('framework changed');
    });

    it('keeps the captured input when approval changes before result persistence', async () => {
      const { ref } = await approvedFramework();
      await service.rememberGenerationFramework(req, 'brand-kit', PROJECT, 'dependent-1', ref);
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('New framework'), PROJECT, 'framework-2');
      await approveStored(FRAMEWORK, 2);
      await service.persistGeneration(req, SPEC, envelope('# Synthetic kit'), PROJECT, 'dependent-1');
      const kit = revisionKeys().find((key) => key.includes('/brand-kit/'));
      expect(kit).toBeDefined();
      expect(storedRecord(kit ?? '').bundle.sidecar?.['upstreamFramework']).toEqual(ref);
      const listed = await service.listDocuments(req, PROJECT);
      expect(listed.groups.find((group) => group.type.agentKey === 'brand-kit')?.documents[0].needsRebuild?.builtFrom).toEqual(ref);
    });

    it('projects staleness from HEAD metadata without downloading any revision bodies', async () => {
      const { ref } = await approvedFramework();
      await service.rememberGenerationFramework(req, 'brand-kit', PROJECT, 'dependent-1', ref);
      await service.persistGeneration(req, SPEC, envelope('# Synthetic kit'), PROJECT, 'dependent-1');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Changed'), PROJECT, 'framework-2');
      await approveStored(FRAMEWORK, 2);
      store.reads.length = 0;
      const listed = await service.listDocuments(req, PROJECT);
      expect(listed.groups.find((group) => group.type.agentKey === 'brand-kit')?.documents[0].needsRebuild).toBeTruthy();
      expect(store.reads.filter((key) => /\/[0-9]{6}-[a-f0-9]{64}\.json$/.test(key))).toEqual([]);
      const kit = revisionKeys().find((key) => key.includes('/brand-kit/'));
      const metadata = storedObject(kit ?? '').metadata;
      expect(Object.entries(metadata).reduce((bytes, [key, value]) => bytes + Buffer.byteLength(key + value), 0)).toBeLessThan(2048);
    });

    it('never trusts an agent-supplied upstream ref or guesses unknown sessions from current approval', async () => {
      const { ref } = await approvedFramework();
      await service.persistGeneration(
        req,
        SPEC,
        { ...envelope('# Unknown provenance'), upstreamFramework: ref } as MktgArtifactEnvelope,
        PROJECT,
        'old-session'
      );
      const kit = revisionKeys().find((key) => key.includes('/brand-kit/'));
      expect(storedRecord(kit ?? '').bundle.sidecar).not.toHaveProperty('upstreamFramework');
      expect((await service.listDocuments(req, PROJECT)).groups.find((group) => group.type.agentKey === 'brand-kit')?.documents[0].needsRebuild).toBeNull();
    });

    it('makes same-capture retry idempotent and rejects a different capture for the same session', async () => {
      const { ref } = await approvedFramework();
      await service.rememberGenerationFramework(req, 'brand-kit', PROJECT, 'dependent-1', ref);
      await service.rememberGenerationFramework(req, 'brand-kit', PROJECT, 'dependent-1', ref);
      if (!ref) throw new Error('Expected synthetic approved input');
      await expect(service.rememberGenerationFramework(req, 'brand-kit', PROJECT, 'dependent-1', { ...ref, revisionNumber: 99 })).rejects.toThrow();
    });

    it('fails closed on a corrupt capture or failed write, leaving persistence retryable', async () => {
      const { ref } = await approvedFramework();
      store.failPutsMatching = /generation-provenance/;
      await expect(service.rememberGenerationFramework(req, 'brand-kit', PROJECT, 'dependent-1', ref)).rejects.toThrow();
      store.failPutsMatching = null;
      await service.rememberGenerationFramework(req, 'brand-kit', PROJECT, 'dependent-1', ref);
      const capture = [...store.objects.keys()].find((key) => key.startsWith('generation-provenance/'));
      storedObject(capture ?? '').body = '{}';
      expect(await service.persistGeneration(req, SPEC, envelope('# Retry later'), PROJECT, 'dependent-1')).toBeNull();
      expect(revisionKeys().filter((key) => key.includes('/brand-kit/'))).toEqual([]);
    });
  });

  async function approveStored(type: MktgDocumentType, number: number): Promise<void> {
    const revision = (await service.getDocument(req, PROJECT, type, 'living'))?.revisions.find((entry) => entry.number === number);
    if (!revision) throw new Error('Missing synthetic stored revision');
    await service.approveRevision(req, PROJECT, type, 'living', revision.id);
  }

  describe('approval on the single current record', () => {
    const key = `documents/${PROJECT}/brand-kit/living/current.json`;

    async function twoRevisions() {
      const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
      const second = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Second'), 'second');
      return { first, second };
    }

    it('commits a generated draft while preserving the approved pointer and its selection attribution', async () => {
      const { first } = await twoRevisions();
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      const before = JSON.parse(storedObject(key).body);
      const other = { ...req, oidc: { user: { sub: 'auth0|draft-writer' } } } as unknown as Request;
      store.conditionalWrites = [];
      const draft = await service.recordGeneration(other, BRAND_KIT, PROJECT, envelope('# Third draft'), 'third');
      const after = JSON.parse(storedObject(key).body);
      expect(store.conditionalWrites).toEqual([draft.key, key]); // Immutable publication plus exactly one current-record CAS.
      expect(after).toEqual({ ...before, revisionIds: [...before.revisionIds, draft.id] });
      expect(storedRecord(draft.key).basedOnId).toBe(first.id);
      expect(after.approvals[draft.id]).toBeUndefined();
      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(detail?.approvedCurrent).toEqual({ revisionId: first.id, number: 1 });
      expect(detail?.revisions[0]).toMatchObject({ id: draft.id, number: 3, latest: false, approval: null });
      expect(detail?.revisions.find((revision) => revision.id === first.id)?.latest).toBe(true);
    });

    it.each([false, true])('does not attach a stored Draft or its compatibility artifact without approval (sidecar=%s)', async (withSidecar) => {
      await service.persistGeneration(req, SPEC, envelope('# Stored Draft'), PROJECT, 'draft');
      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(detail?.revisions).toHaveLength(1);
      expect(detail?.approvedCurrent).toBeNull();
      expect(await service.readApprovedCurrentSummary(req, PROJECT, BRAND_KIT, 'living')).toBeNull();
      expect(await service.readLatest(req, SPEC, PROJECT, { withSidecar })).toBeNull();
      await expect(service.readExportRevision(req, PROJECT, BRAND_KIT, 'living', {})).rejects.toMatchObject({ code: 'MKTG_ASSET_NOT_APPROVED' });
    });

    it('keeps approved current as the read/export/listing selection but retains newest identity for export comparison', async () => {
      const { first, second } = await twoRevisions();
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      expect((await service.readLatest(req, SPEC, PROJECT))?.documentMarkdown).toBe('# First');
      expect((await service.readExportRevision(req, PROJECT, BRAND_KIT, 'living', {}))?.revision.id).toBe(first.id);
      const listed = await service.listDocuments(req, PROJECT);
      expect(listed.groups.find((group) => group.type.agentKey === BRAND_KIT.agentKey)?.documents[0]).toMatchObject({
        latestRevisionId: first.id,
        approvedCurrent: { revisionId: first.id, number: 1 },
      });
      expect(await service.readNewestRevisionRef(req, PROJECT, BRAND_KIT, 'living')).toMatchObject({ id: second.id, number: 2 });
    });

    it.each(['missing', 'historical-corrupt'])('distinguishes %s approved current from absent approval with other revisions still readable', async (fault) => {
      const { first } = await twoRevisions();
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      if (fault === 'missing') store.objects.delete(first.key);
      else store.objects.set(first.key, { ...storedObject(first.key), body: 'corrupt', metadata: {} });
      const failure = { statusCode: 502, code: 'MKTG_APPROVED_REVISION_UNREADABLE' };
      store.reads = [];
      await expect(service.readApprovedCurrentSummary(req, PROJECT, BRAND_KIT, 'living')).rejects.toMatchObject(failure);
      expect(store.reads.filter((read) => read === key)).toHaveLength(1);
      await expect(service.readExportRevision(req, PROJECT, BRAND_KIT, 'living', {})).rejects.toMatchObject(failure);
    });

    it('continues newest-is-current generation when no revision has ever been approved', async () => {
      const { second } = await twoRevisions();
      const third = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Third draft'), 'third');
      const record = JSON.parse(storedObject(key).body);
      expect(record.revisionId).toBe(third.id);
      expect(storedRecord(third.key).basedOnId).toBe(second.id);
      expect(record.approvals).toBeUndefined();
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.approvedCurrent).toBeNull();
    });

    it('advances generation from a current draft even when an older revision has an approval annotation', async () => {
      const { first, second } = await twoRevisions();
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', second.id);
      const before = JSON.parse(storedObject(key).body);
      const third = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Third draft'), 'third');
      const after = JSON.parse(storedObject(key).body);
      expect(after.revisionId).toBe(third.id);
      expect(after.approvals).toEqual(before.approvals);
      expect(storedRecord(third.key).basedOnId).toBe(second.id);
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.approvedCurrent).toBeNull();
    });

    it('refuses legacy-only approval with the specified validation error and never migrates or writes a pointer', async () => {
      const markdown = '# Synthetic pre-revision document';
      const legacyKey = seedLegacy(markdown);
      await expect(service.approveRevision(req, PROJECT, BRAND_KIT, 'living', `legacy-${sha(markdown)}`)).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        validationErrors: [expect.objectContaining({ field: 'revisionId', message: 'A revision must be stored before it can be approved.' })],
      });
      expect(store.conditionalWrites).toEqual([]);
      expect([...store.objects.keys()]).toEqual([legacyKey]);
    });

    it('approves and selects in one CAS without changing revision bytes or exposing stored identities', async () => {
      const { first } = await twoRevisions();
      const bytes = revisionKeys().map((key) => storedObject(key).body);
      store.conditionalWrites = [];
      store.reads = [];
      const result = await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      const record = JSON.parse(storedObject(key).body);
      expect(store.conditionalWrites).toEqual([key]);
      expect(store.reads.filter((key) => key.endsWith('current.json'))).toHaveLength(1);
      expect(revisionKeys().map((key) => storedObject(key).body)).toEqual(bytes);
      expect(record.revisionId).toBe(first.id);
      expect(record.approvals[first.id]).toEqual({ approvedAt: record.changedAt, approvedBy: 'auth0|not-the-lfid' });
      expect(result?.approvedCurrent).toEqual({ revisionId: first.id, number: 1 });
      expect(result?.approval).toEqual({ approvedAt: record.changedAt, approvedBy: { name: 'The writer' } });
      expect(JSON.stringify(result)).not.toContain('auth0|');
      expect(JSON.stringify(result)).not.toContain('revisionIds');
      expect([...store.objects.keys()].filter((key) => !revisionKeys().includes(key))).toEqual([key]);
    });

    it('does not write when the current revision is already approved', async () => {
      const { first } = await twoRevisions();
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      const body = storedObject(key).body;
      store.conditionalWrites = [];
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      expect(store.conditionalWrites).toEqual([]);
      expect(storedObject(key).body).toBe(body);
    });

    it('Make current preserves annotations and selecting a draft does not imply approval', async () => {
      const { first, second } = await twoRevisions();
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      const annotation = JSON.parse(storedObject(key).body).approvals[first.id];
      const restored = await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', second.id);
      expect(restored?.detail.approvedCurrent).toBeNull();
      expect(JSON.parse(storedObject(key).body).approvals[first.id]).toEqual(annotation);
      const selected = await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      expect(selected?.detail.approvedCurrent?.revisionId).toBe(first.id);
      await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', second.id);
      const other = { ...req, oidc: { user: { sub: 'auth0|other-approver' } } } as unknown as Request;
      const approvedAgain = await service.approveRevision(other, PROJECT, BRAND_KIT, 'living', first.id);
      const record = JSON.parse(storedObject(key).body);
      expect(record.approvals[first.id]).toEqual(annotation);
      expect(record.changedBy).toBe('auth0|other-approver');
      expect(approvedAgain?.approval?.approvedAt).toBe(annotation.approvedAt);
    });

    it('preserves unreadable committed IDs when approving a readable revision', async () => {
      const { first, second } = await twoRevisions();
      const ids = JSON.parse(storedObject(key).body).revisionIds;
      storedObject(second.key).body = '{}';
      await service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      expect(JSON.parse(storedObject(key).body).revisionIds).toEqual(ids);
    });

    it('fails once on CAS contention with the exact Make current 412 and no annotation write', async () => {
      const { first } = await twoRevisions();
      const before = storedObject(key).body;
      store.rejectComparisons = true;
      store.conditionalWrites = [];
      await expect(service.approveRevision(req, PROJECT, BRAND_KIT, 'living', first.id)).rejects.toMatchObject({
        statusCode: 412,
        code: 'PRECONDITION_FAILED',
        message: 'The document changed while making a revision current. Reload and try again.',
      });
      expect(store.conditionalWrites).toEqual([key]);
      expect(storedObject(key).body).toBe(before);
    });

    it.each([undefined, null, [], 'unknown-schema', 42, { unknown: { approvedAt: 'bad', approvedBy: null } }])(
      'ignores optional or malformed annotations (%j)',
      async (approvals) => {
        const { second } = await twoRevisions();
        storedObject(key).body = JSON.stringify({ ...JSON.parse(storedObject(key).body), approvals });
        const result = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
        expect(result?.current?.revisionId).toBe(second.id);
        expect(result?.approvedCurrent).toBeNull();
        expect(result?.revisions.every((revision) => revision.approval === null)).toBe(true);
      }
    );

    it.each(['auth0|target', null])('uses the effective impersonation target, never the operator (%s)', async (sub) => {
      const { first } = await twoRevisions();
      const impersonated = {
        ...req,
        oidc: { user: { sub: 'auth0|operator' } },
        impersonationActive: true,
        appSession: { impersonationUser: { username: 'synthetic-target', ...(sub && { sub }) } },
      } as unknown as Request;
      const result = await service.approveRevision(impersonated, PROJECT, BRAND_KIT, 'living', first.id);
      const record = JSON.parse(storedObject(key).body);
      expect(record.changedBy).toBe(sub);
      expect(record.approvals[first.id].approvedBy).toBe(sub);
      expect(result?.approval?.approvedBy).toEqual(sub ? { name: 'The writer' } : null);
      expect(JSON.stringify(result)).not.toContain('auth0|operator');
    });

    it('rejects approval on one-off documents with the approval-specific validation reason', async () => {
      const saved = await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Run'), 'run');
      store.conditionalWrites = [];
      await expect(service.approveRevision(req, PROJECT, LINKEDIN, saved.key.split('/')[3], saved.id)).rejects.toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        validationErrors: [expect.objectContaining({ field: 'documentId', message: 'Approve is not available for one-off run documents.' })],
      });
      expect(store.conditionalWrites).toEqual([]);
    });
  });

  describe('persistGeneration', () => {
    it('writes the artifact as before and records it as revision 1 with its bundle, empty comments and an empty deck', async () => {
      const generated = envelope('# Brand Kit\n\nStatus: Draft — for review\n');

      const receipt = await service.persistGeneration(req, SPEC, generated, PROJECT, 'session-1');

      expect(store.objects.has(`brand-kit/${PROJECT}/${generated.content_sha256}.md`)).toBe(true);
      const keys = revisionKeys();
      expect(keys).toHaveLength(1);
      expect(receipt?.s3_key).toBe(keys[0]);
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

  describe('persistJsonGeneration — an agent whose output is a structured asset', () => {
    it('records the content’s JSON text as a JSON revision with the rest of the envelope as the sidecar, and writes no Markdown object', async () => {
      const generated = jsonEnvelope('Search, open.');

      const receipt = await service.persistJsonGeneration(req, FRAMEWORK_SPEC, generated, PROJECT, 'session-1');

      const keys = revisionKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]).toMatch(new RegExp(`^documents/${PROJECT}/foundation-message/living/000001-[0-9a-f]{64}\\.json$`));
      // The revision IS the stored copy: the receipt names its key, and nothing lands in the pre-revision `.md` partition.
      expect(receipt).toEqual({ s3_key: keys[0], content_sha256: generated.content_sha256, project: PROJECT, version: 1, intake_mode: 'form' });
      expect([...store.objects.keys()].filter((key) => key.endsWith('.md'))).toEqual([]);

      const record = storedRecord(keys[0]);
      expect(record.bundle.format).toBe('json');
      expect(record.bundle.markdown).toBe(JSON.stringify(generated.content));
      expect(record.bundle.contentSha256).toBe(generated.content_sha256);
      expect(record.bundle.sidecar).toMatchObject({ contract: 'messaging-framework-output/v1', report: { gaps: ['No member count.'] }, mode: 'draft' });
      expect(record.bundle.sidecar).not.toHaveProperty('content');
    });

    it('serves the JSON revision to the Documents area with its format and sidecar, and to dependent agents as its text', async () => {
      const generated = jsonEnvelope('Search, open.');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, generated, PROJECT, 'session-1');

      const detail = await service.getDocument(req, PROJECT, FRAMEWORK, 'living');
      expect(detail?.revisions[0]).toMatchObject({ number: 1, format: 'json', status: '', latest: true });
      const revision = await service.getRevision(req, PROJECT, FRAMEWORK, 'living', detail?.revisions[0].id as string);
      expect(revision?.markdown).toBe(JSON.stringify(generated.content));
      expect(revision?.sidecar).toMatchObject({ report: { gaps: ['No member count.'] } });

      expect(await service.readLatest(req, FRAMEWORK_SPEC, PROJECT)).toBeNull();
      await approveStored(FRAMEWORK, 1);
      const latest = await service.readLatest(req, FRAMEWORK_SPEC, PROJECT);
      // The format travels with the bytes, so a dependent agent's read renders the JSON instead of attaching it as Markdown.
      expect(latest).toMatchObject({ documentMarkdown: JSON.stringify(generated.content), format: 'json', receipt: { s3_key: revisionKeys()[0], version: 1 } });
    });

    it('never serves the pre-4.0 Markdown copy to dependent agents when the JSON revisions cannot be read', async () => {
      const legacyKey = `foundation-message/${PROJECT}/${sha('# Old framework\n')}.md`;
      store.objects.set(legacyKey, { body: '# Old framework\n', metadata: { version: '1', 'intake-mode': 'form' }, lastModified: new Date(0) });
      await expect(service.readLatest(req, FRAMEWORK_SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: '# Old framework\n' });

      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Search, open.'), PROJECT, 'session-1');
      store.failListsMatching = /^documents\//;
      await expect(service.readLatest(req, FRAMEWORK_SPEC, PROJECT)).rejects.toThrow('store unavailable');

      store.failListsMatching = null;
      store.failGetsMatching = /^documents\//;
      await expect(service.readLatest(req, FRAMEWORK_SPEC, PROJECT)).rejects.toThrow('store unavailable');
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_document_store_read_latest', expect.stringContaining('rethrowing'), expect.any(Object));
    });

    it('records a JSON generation once per session and bytes, adds a revision per new generation, and restores an older one as JSON', async () => {
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('First.'), PROJECT, 'session-1');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('First.'), PROJECT, 'session-1');
      const initial = await service.getDocument(req, PROJECT, FRAMEWORK, 'living');
      expect(initial?.revisions).toHaveLength(1);
      const pointer = JSON.parse(store.objects.get(`documents/${PROJECT}/foundation-message/living/current.json`)?.body ?? '{}');
      expect(pointer.revisionId).toBe(initial?.revisions[0].id);
      expect(pointer.revisionIds).toEqual([initial?.revisions[0].id]);
      expect(pointer.changedBy).toBe('auth0|not-the-lfid');
      expect(store.objects.get(revisionKeys()[0])?.metadata['author-id']).toBe('auth0|not-the-lfid');
      expect(JSON.stringify(initial)).not.toContain('auth0|');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Second.'), PROJECT, 'session-2');
      expect(revisionKeys()).toHaveLength(2);
      expect(storedRecord(revisionKeys()[1]).basedOnId).toBe(initial?.revisions[0].id);

      const detail = await service.getDocument(req, PROJECT, FRAMEWORK, 'living');
      const restored = await service.restoreRevision(req, PROJECT, FRAMEWORK, 'living', detail?.revisions[1].id as string);
      expect(restored?.revision).toMatchObject({ number: 1, origin: 'generated', format: 'json', latest: true });
      expect(revisionKeys()).toHaveLength(2);
      const opened = await service.getRevision(req, PROJECT, FRAMEWORK, 'living', restored?.revision.id as string);
      expect(opened?.sidecar).toMatchObject({ report: { gaps: ['No member count.'] } });
      await expect(service.readLatest(req, FRAMEWORK_SPEC, PROJECT)).resolves.toBeNull();
      await approveStored(FRAMEWORK, 1);
      await expect(service.readLatest(req, FRAMEWORK_SPEC, PROJECT)).resolves.toMatchObject({
        documentMarkdown: JSON.stringify(jsonEnvelope('First.').content),
      });
      await expect(service.readLatest(req, FRAMEWORK_SPEC, PROJECT, { withSidecar: true })).resolves.toMatchObject({
        documentMarkdown: JSON.stringify(jsonEnvelope('First.').content),
        revisionNumber: 1,
        sidecar: { content: jsonEnvelope('First.').content, report: { gaps: ['No member count.'] } },
      });
    });

    it('does not expose legacy Markdown when an eligible historical JSON revision is unreadable without a pointer', async () => {
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Current JSON'), PROJECT, 'json');
      const key = revisionKeys()[0];
      const object = store.objects.get(key);
      if (!object) throw new Error('Expected the JSON fixture');
      object.metadata = { origin: 'generated', sequence: '1' };
      object.body = 'corrupted historical JSON revision';
      store.objects.delete(`documents/${PROJECT}/foundation-message/living/current.json`);
      const markdown = '# Stale legacy framework';
      store.objects.set(`foundation-message/${PROJECT}/${sha(markdown)}.md`, {
        body: markdown,
        metadata: { version: '1', 'intake-mode': 'form' },
        lastModified: new Date(0),
      });
      await expect(service.readLatest(req, FRAMEWORK_SPEC, PROJECT)).resolves.toBeNull();
      await expect(service.getDocument(req, PROJECT, FRAMEWORK, 'living')).resolves.toBeNull();
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'mktg_document_store_read_document',
        'No stored revision could be read — serving no stored document',
        expect.any(Object)
      );
    });

    it('records nothing without the writer grant, and drops the receipt when the revision cannot be written', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: false });
      await expect(service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('x'), PROJECT, 'session-1')).resolves.toBeNull();
      expect(store.objects.size).toBe(0);

      projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: true });
      store.failPutsMatching = /^documents\//;
      await expect(service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('x'), PROJECT, 'session-1')).resolves.toBeNull();
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_document_store_record', expect.stringContaining('Revision write failed'), expect.any(Object));
    });
  });

  describe('committed manifest recovery', () => {
    it.each([
      { action: 'append', fault: 'missing' },
      { action: 'append', fault: 'corrupt' },
      { action: 'make-current', fault: 'missing' },
      { action: 'make-current', fault: 'corrupt' },
    ])('preserves and recovers a $fault revision after $action', async ({ action, fault }) => {
      const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
      const second = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Second'), 'second');
      const third = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Third'), 'third');
      const unreadable = action === 'append' ? second : third;
      const original = storedObject(unreadable.key);
      if (fault === 'missing') store.objects.delete(unreadable.key);
      else store.objects.set(unreadable.key, { ...original, body: 'invalid revision bytes', metadata: { origin: 'generated' } });
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions.some((entry) => entry.id === unreadable.id)).toBe(false);
      if (action === 'append') await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Fourth'), 'fourth');
      else await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      const manifest = JSON.parse(storedObject(`documents/${PROJECT}/brand-kit/living/current.json`).body);
      expect(manifest.revisionIds).toEqual(expect.arrayContaining([first.id, second.id, third.id]));
      expect(new Set(manifest.revisionIds).size).toBe(manifest.revisionIds.length);
      store.objects.set(unreadable.key, original);
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions.some((entry) => entry.id === unreadable.id)).toBe(true);
      expect((await service.getRevision(req, PROJECT, BRAND_KIT, 'living', unreadable.id))?.markdown).toBe(unreadable.record.bundle.markdown);
    });
  });

  describe('first-publication manifest recovery', () => {
    it.each(['append', 'make-current'])('keeps unreadable historical IDs on first %s publication but not orphan or malformed IDs', async (action) => {
      const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Historical first'), 'first');
      const second = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Historical second'), 'second');
      const third = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Historical third'), 'third');
      const currentKey = `documents/${PROJECT}/brand-kit/living/current.json`;
      store.failPutsMatching = /current\.json$/;
      await expect(service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Uncommitted orphan'), 'orphan')).rejects.toThrow('store unavailable');
      store.failPutsMatching = null;
      const orphanKey = revisionKeys().find((key) => ![first.key, second.key, third.key].includes(key));
      if (!orphanKey) throw new Error('Expected the failed pointer write to leave an orphan fixture');
      const orphanId = orphanKey.slice(orphanKey.lastIndexOf('/') + 1, -5);
      expect(storedObject(orphanKey).metadata['managed']).toBe('true');
      store.objects.delete(currentKey);
      for (const revision of [first, second, third]) {
        storedObject(revision.key).metadata = { origin: 'generated', sequence: String(revision.record.sequence) };
      }
      const original = { ...storedObject(second.key) };
      store.objects.set(second.key, { ...original, body: 'unreadable historical body' });
      const invalidId = `000000-${'f'.repeat(64)}`;
      store.objects.set(`documents/${PROJECT}/brand-kit/living/${invalidId}.json`, { ...original });
      const before = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(before?.revisions.map((entry) => entry.id)).toEqual([third.id, first.id]);
      expect(store.objects.has(currentKey)).toBe(false);
      if (action === 'append') await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# New generation'), 'new');
      else await service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      const manifest = JSON.parse(storedObject(currentKey).body);
      expect(manifest.revisionIds).toEqual(expect.arrayContaining([first.id, second.id, third.id]));
      expect(manifest.revisionIds).not.toContain(orphanId);
      expect(manifest.revisionIds).not.toContain(invalidId);
      expect(new Set(manifest.revisionIds).size).toBe(manifest.revisionIds.length);
      store.objects.set(second.key, original);
      const recovered = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(recovered?.revisions.some((entry) => entry.id === second.id)).toBe(true);
      expect(recovered?.revisions.some((entry) => entry.id === orphanId || entry.id === invalidId)).toBe(false);
      expect((await service.getRevision(req, PROJECT, BRAND_KIT, 'living', second.id))?.markdown).toBe(second.record.bundle.markdown);
    });
  });

  describe('PR round 2 contracts', () => {
    it.each(['automatic', 'explicit', 'root'])('retries a lost CAS with a fresh sequence and the %s base contract', async (base) => {
      const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Initial'), 'initial');
      const markdown = '# Retried';
      const fields: MktgRevisionRecordFields = {
        createdAt: '2026-10-19T09:00:00.000Z',
        origin: 'generated',
        restoredFromId: null,
        source: { sessionId: 'retried', draftVersion: 1, intakeMode: 'form' },
        bundle: { markdown, contentSha256: sha(markdown), sidecar: null, brandFile: null },
      };
      if (base === 'explicit') fields.basedOnId = first.id;
      if (base === 'root') fields.basedOnId = null;
      let competingId = '';
      store.rejectComparisons = true;
      store.onRejectedComparison = async () => {
        store.rejectComparisons = false;
        competingId = (await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Concurrent'), 'concurrent')).id;
      };
      const saved = await service.recordRevision(req, PROJECT, BRAND_KIT, 'living', fields, sha(`retried:${sha(markdown)}`));
      let expectedBase: string | null = competingId;
      if (base === 'explicit') expectedBase = first.id;
      if (base === 'root') expectedBase = null;
      expect(saved.record.sequence).toBe(3);
      expect(saved.record.basedOnId).toBe(expectedBase);
      expect(competingId).not.toBe('');
      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(detail?.revisions.map((entry) => entry.number)).toEqual([3, 2, 1]);
      expect(detail?.revisions.filter((entry) => entry.contentSha256 === sha(markdown))).toHaveLength(1);
      expect(detail?.current?.revisionId).toBe(saved.id);
    });

    it.each(['auth0|target', null])('writes and makes current with only the impersonation target subject %s', async (targetSub) => {
      const impersonated = {
        ...req,
        oidc: { user: { sub: 'auth0|operator', 'https://sso.linuxfoundation.org/claims/username': 'synthetic-operator', name: 'The operator' } },
        impersonationActive: true,
        appSession: { impersonationUser: { username: 'synthetic-target', ...(targetSub && { sub: targetSub }) } },
      } as unknown as Request;
      directoryMocks.getUserInfo.mockResolvedValue({ success: true, data: { name: 'The target' } });
      const first = await service.recordGeneration(impersonated, BRAND_KIT, PROJECT, envelope('# Initial'), 'initial');
      await service.recordGeneration(impersonated, BRAND_KIT, PROJECT, envelope('# Newer'), 'newer');
      const currentKey = `documents/${PROJECT}/brand-kit/living/current.json`;
      expect(JSON.parse(storedObject(currentKey).body).changedBy).toBe(targetSub);
      const restored = await service.restoreRevision(impersonated, PROJECT, BRAND_KIT, 'living', first.id);
      expect(restored?.revision.id).toBe(first.id);
      expect(revisionKeys()).toHaveLength(2);
      expect(JSON.parse(storedObject(currentKey).body).changedBy).toBe(targetSub);
      for (const key of revisionKeys()) {
        if (targetSub) expect(storedObject(key).metadata['author-id']).toBe(targetSub);
        else expect(storedObject(key).metadata).not.toHaveProperty('author-id');
      }
      if (targetSub) expect(restored?.detail.current?.changedBy).toEqual({ name: 'The target' });
      else {
        expect(restored?.detail.current?.changedBy).toBeNull();
        expect(restored?.detail.revisions.every((entry) => entry.author === null)).toBe(true);
        expect(directoryMocks.getUserInfo).not.toHaveBeenCalled();
      }
      const stored = JSON.stringify([...store.objects.values()]);
      expect(stored).not.toContain('auth0|operator');
      expect(stored).not.toContain('synthetic-operator');
      expect(stored).not.toContain('synthetic-target');
    });

    it('still refuses an ordinary writer without a subject', async () => {
      const unidentified = { oidc: { user: { name: 'The writer' } }, impersonationActive: false } as unknown as Request;
      await expect(service.recordGeneration(unidentified, BRAND_KIT, PROJECT, envelope('# New'), 'new')).rejects.toMatchObject({
        statusCode: 401,
        message: 'A signed-in writer subject is required when not impersonating.',
      });
      expect(store.objects.size).toBe(0);
    });
  });

  describe('PR attribution and listing regressions', () => {
    it('stores only the opaque subject and resolves one directory name per ID per request', async () => {
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# One'), 'one');
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Two'), 'two');
      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(detail?.revisions.every((revision) => revision.author?.name === 'The writer')).toBe(true);
      expect(directoryMocks.getUserInfo).toHaveBeenCalledExactlyOnceWith(req, 'auth0|not-the-lfid');
      for (const key of revisionKeys()) {
        expect(store.objects.get(key)?.metadata['author-id']).toBe('auth0|not-the-lfid');
        expect(store.objects.get(key)?.metadata).not.toHaveProperty('author');
      }
      expect(JSON.stringify([...store.objects.values()])).not.toMatch(/synthetic-writer|The writer/);
      expect(JSON.stringify(detail)).not.toContain('auth0|');
    });

    it.each([new Error('NATS timeout'), new ResourceNotFoundError('User'), new MicroserviceError('NATS unavailable', 503, 'SERVICE_UNAVAILABLE')])(
      'lookup failure %s shows no name without failing reads and warns once per ID',
      async (failure) => {
        await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# One'), 'one');
        await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Two'), 'two');
        directoryMocks.getUserInfo.mockRejectedValue(failure);
        const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
        expect(detail?.revisions.map((revision) => revision.author)).toEqual([{ name: null }, { name: null }]);
        expect(detail?.current?.changedBy).toEqual({ name: null });
        expect(directoryMocks.getUserInfo).toHaveBeenCalledTimes(1);
        expect(loggerMocks.warning.mock.calls.filter((call) => call[1] === 'mktg_document_store_author')).toHaveLength(1);
        await expect(service.listDocuments(req, PROJECT)).resolves.toMatchObject({ project: PROJECT });
      }
    );

    it('handles an unsuccessful directory response directly and warns once for the stored author', async () => {
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# One'), 'one');
      directoryMocks.getUserInfo.mockResolvedValue({ success: false, error: 'user not found' });
      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(detail?.revisions[0].author).toEqual({ name: null });
      expect(detail?.current?.changedBy).toEqual({ name: null });
      expect(directoryMocks.getUserInfo).toHaveBeenCalledTimes(1);
      expect(loggerMocks.warning).toHaveBeenCalledExactlyOnceWith(req, 'mktg_document_store_author', 'Author lookup failed — showing no name');
    });

    it('bounds distinct directory reads and discards the memo between requests', async () => {
      for (let index = 0; index < 9; index++) {
        const saved = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope(`# ${index}`), `session-${index}`);
        const object = store.objects.get(saved.key);
        if (!object) throw new Error('Expected synthetic revision to exist');
        object.metadata['author-id'] = `auth0|writer-${index}`;
      }
      let active = 0;
      let maximum = 0;
      directoryMocks.getUserInfo.mockImplementation(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
        return { success: true, data: { name: 'The writer' } };
      });
      await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
      expect(maximum).toBe(4);
      expect(directoryMocks.getUserInfo).toHaveBeenCalledTimes(10); // Nine authors plus the selector.
      await service.getDocument({ ...req } as Request, PROJECT, BRAND_KIT, 'living');
      expect(directoryMocks.getUserInfo).toHaveBeenCalledTimes(20);
    });

    it('never uses a directory username when no display name is returned', async () => {
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# One'), 'one');
      directoryMocks.getUserInfo.mockResolvedValue({ success: true, username: 'synthetic-writer', data: {} });
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[0].author).toEqual({ name: null });
    });

    it('keeps navigation best-effort but strictly rejects unreadable family documents, not missing ones', async () => {
      await expect(service.listDocuments(req, PROJECT, [BRAND_KIT.agentKey])).resolves.toMatchObject({ project: PROJECT });
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# One'), 'one');
      const run = await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Run'), 'run');
      const pointer = store.objects.get(`documents/${PROJECT}/brand-kit/living/current.json`);
      if (!pointer) throw new Error('Expected synthetic pointer to exist');
      pointer.body = 'not json';
      await expect(service.listDocuments(req, PROJECT, [BRAND_KIT.agentKey])).rejects.toBeInstanceOf(MicroserviceError);
      const listed = await service.listDocuments(req, PROJECT);
      expect(listed.groups.find((group) => group.type.agentKey === 'brand-kit')?.documents).toEqual([]);
      expect(listed.groups.find((group) => group.type.agentKey === 'linkedin-post')?.documents[0].documentId).toBe(run.record.documentId);
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'mktg_document_store_list',
        'Document unreadable — omitting',
        expect.objectContaining({ err: expect.any(Error) })
      );
    });

    it.each([401, 403])('does not turn an authorization error %s into an empty listing', async (statusCode) => {
      vi.spyOn(service, 'getDocument').mockRejectedValue(new MicroserviceError('Access denied', statusCode, 'FORBIDDEN'));
      await expect(service.listDocuments(req, PROJECT)).rejects.toMatchObject({ statusCode });
    });
  });

  describe('PR persistence regressions', () => {
    it.each([true, false])('first ICP save produces one revision with an existing same-SHA artifact (managed=%s)', async (managed) => {
      const generated = envelope('# ICP');
      store.objects.set(`icp/${PROJECT}/${generated.content_sha256}.md`, {
        body: generated.document_markdown,
        metadata: { version: '1', ...(managed && { 'revision-managed': 'true' }) },
        lastModified: new Date(0),
      });
      const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === 'icp') as MktgDocumentType;
      await service.recordGeneration(req, type, PROJECT, generated, 'icp');
      expect(revisionKeys()).toHaveLength(1);
      expect(storedRecord(revisionKeys()[0]).origin).toBe('generated');
    });

    it('deduplicates a repeated pre-upgrade poll without generation metadata or a pointer', async () => {
      const generated = envelope('# One');
      const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, generated, 'old-session');
      storedObject(first.key).metadata = { origin: 'generated', sequence: '1' };
      store.objects.delete(`documents/${PROJECT}/brand-kit/living/current.json`);
      const repeated = await service.recordGeneration(req, BRAND_KIT, PROJECT, generated, 'old-session');
      expect(repeated.id).toBe(first.id);
      expect(revisionKeys()).toHaveLength(1);
      expect(store.objects.has(`documents/${PROJECT}/brand-kit/living/current.json`)).toBe(false);
    });

    it('bounds long status metadata while a loaded revision keeps the full status', async () => {
      const status = `Draft — ${'x'.repeat(3000)}`;
      const saved = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope(`# One\nStatus: ${status}`), 'one');
      const metadata = storedObject(saved.key).metadata;
      expect(Object.entries(metadata).reduce((bytes, [key, value]) => bytes + Buffer.byteLength(key + value), 0)).toBeLessThan(2048);
      expect(Buffer.from(metadata['status'], 'base64').toString()).toBe(`${status.slice(0, 199)}…`);
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[0].status).toHaveLength(200);
      expect((await service.getRevision(req, PROJECT, BRAND_KIT, 'living', saved.id))?.revision.status).toBe(status);
    });

    it.each(['corrupt', 'missing'])('tries older valid legacy artifacts when the newest is %s', async (fault) => {
      seedLegacy('# Older');
      const newest = seedLegacy('# Newer');
      if (fault === 'corrupt') storedObject(newest).body = 'mismatching bytes';
      else store.missingBodyKey = newest;
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Generated'), 'generated');
      expect(storedRecord(revisionKeys()[0]).bundle.markdown).toBe('# Older');
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_document_store_legacy', expect.stringContaining('skipping'), expect.any(Object));
    });

    it('computes legacy status when the body is opened, not on metadata-only listings', async () => {
      const markdown = '# Legacy\nStatus: Draft — Review';
      seedLegacy(markdown);
      expect((await service.getDocument(req, PROJECT, BRAND_KIT, 'living'))?.revisions[0].status).toBe('');
      expect((await service.getRevision(req, PROJECT, BRAND_KIT, 'living', `legacy-${sha(markdown)}`))?.revision.status).toBe('Draft — Review');
    });
  });

  it('commits overlapping polls once, with attribution outside hashed bytes', async () => {
    const generated = envelope('# Concurrent\n');
    await Promise.all([service.persistGeneration(req, SPEC, generated, PROJECT, 'same'), service.persistGeneration(req, SPEC, generated, PROJECT, 'same')]);
    const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(detail?.revisions).toHaveLength(1);
    expect(detail?.revisions[0].author).toEqual({ name: 'The writer' });
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
    await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toBeNull();
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
    await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toBeNull();
    expect(store.maxHeads).toBeLessThanOrEqual(4);
  });

  it('reads a single pointer snapshot and one selected new body for dependencies', async () => {
    await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
    await approveStored(BRAND_KIT, 1);
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

  it.each([false, true])('handles a missing effective sub (impersonating=%s)', async (impersonating) => {
    const unidentified = {
      oidc: {
        user: { ...(impersonating && { sub: 'auth0|operator' }), 'https://sso.linuxfoundation.org/claims/username': 'synthetic-writer', name: 'The writer' },
      },
      impersonationActive: impersonating,
      appSession: { impersonationUser: { username: 'synthetic-target', name: 'The target' } },
    } as unknown as Request;
    const writing = service.recordGeneration(unidentified, BRAND_KIT, PROJECT, envelope('# New'), 'new');
    if (impersonating) {
      const saved = await writing;
      expect(storedObject(saved.key).metadata).not.toHaveProperty('author-id');
      expect(JSON.parse(storedObject(`documents/${PROJECT}/brand-kit/living/current.json`).body).changedBy).toBeNull();
      expect(JSON.stringify([...store.objects.values()])).not.toContain('auth0|operator');
    } else {
      await expect(writing).rejects.toMatchObject({ statusCode: 401 });
      expect(store.objects.size).toBe(0);
    }
  });

  it('persists only the effective impersonation target sub and resolves the target name on read', async () => {
    const impersonated = {
      ...req,
      impersonationActive: true,
      appSession: { impersonationUser: { username: 'synthetic-target', sub: 'auth0|target', name: 'The target' } },
    } as unknown as Request;
    await service.recordGeneration(impersonated, BRAND_KIT, PROJECT, envelope('# Target'), 'target');
    directoryMocks.getUserInfo.mockResolvedValue({ success: true, data: { name: 'The target' } });
    const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');
    expect(detail?.revisions[0].author).toEqual({ name: 'The target' });
    expect(directoryMocks.getUserInfo).toHaveBeenCalledExactlyOnceWith(req, 'auth0|target');
    const current = JSON.parse(store.objects.get(`documents/${PROJECT}/brand-kit/living/current.json`)!.body);
    expect(current.changedBy).toBe('auth0|target');
    expect(store.objects.get(revisionKeys()[0])?.metadata['author-id']).toBe('auth0|target');
    expect(JSON.stringify([...store.objects.values()])).not.toMatch(/synthetic-target|The target|synthetic-writer|The writer/);
    expect(JSON.stringify(detail)).not.toContain('auth0|');
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
    it('moves only current to an older revision, without approving it for dependent reads', async () => {
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
      expect(current).toMatchObject({ revisionId: first!.id, changedBy: 'auth0|not-the-lfid', changedAt: expect.any(String) });
      expect(restored?.detail.current).toEqual({ revisionId: current.revisionId, changedAt: current.changedAt, changedBy: { name: 'The writer' } });
      expect(restored?.detail.current).not.toHaveProperty('revisionIds');

      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toBeNull();
      await approveStored(BRAND_KIT, 1);
      const latest = await service.readLatest(req, SPEC, PROJECT);
      expect(latest?.documentMarkdown).toBe('# First\n');
      expect(latest?.format).toBe('markdown');
      expect(latest?.receipt.s3_key).toBe(`brand-kit/${PROJECT}/${sha('# First\n')}.md`);
    });

    it('exposes selection attribution separately from revision authorship and preserves it on a no-op', async () => {
      const first = await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# First'), 'first');
      await service.recordGeneration(req, BRAND_KIT, PROJECT, envelope('# Second'), 'second');
      const selector = {
        ...req,
        oidc: { user: { sub: 'auth0|selector', 'https://sso.linuxfoundation.org/claims/username': 'synthetic-selector', name: 'The selector' } },
      } as unknown as Request;
      const selected = await service.restoreRevision(selector, PROJECT, BRAND_KIT, 'living', first.id);
      const opened = await service.getRevision(req, PROJECT, BRAND_KIT, 'living', first.id);
      expect(opened?.revision.author).toEqual({ name: 'The writer' });
      expect(opened?.current).toEqual(selected?.detail.current);
      expect(opened?.current).toMatchObject({
        revisionId: first.id,
        changedAt: expect.any(String),
        changedBy: { name: 'The selector' },
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
      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toBeNull();
      await approveStored(BRAND_KIT, 1);
      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: legacyMarkdown });
    });

    it('returns null for a revision the document does not have', async () => {
      await service.persistGeneration(req, SPEC, envelope('# Only\n'), PROJECT, 'session-1');

      await expect(service.restoreRevision(req, PROJECT, BRAND_KIT, 'living', `000009-${'a'.repeat(64)}`)).resolves.toBeNull();
    });
  });

  describe('readExportRevision — the revision an export names', () => {
    it('exports approved current and rejects a selector for the newer Draft instead of changing bytes silently', async () => {
      const first = jsonEnvelope('First');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, first, PROJECT, 'session-1');
      const second = jsonEnvelope('Second');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, second, PROJECT, 'session-2');
      const [firstKey] = revisionKeys();
      const firstId = firstKey.split('/').pop()?.replace('.json', '') ?? '';
      await approveStored(FRAMEWORK, 1);

      const byId = await service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', { revisionId: firstId });
      expect(byId?.summary).toMatchObject({ id: firstId, number: 1, latest: true, contentSha256: first.content_sha256 });
      expect(JSON.parse(byId?.revision.record.bundle.markdown ?? '{}')).toMatchObject({ mf: { tagline: 'First' } });

      const byOlderSha = await service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', { contentSha256: first.content_sha256 });
      expect(byOlderSha?.summary).toMatchObject({ id: firstId, number: 1, latest: true });
      expect(JSON.parse(byOlderSha?.revision.record.bundle.markdown ?? '{}')).toMatchObject({ mf: { tagline: 'First' } });

      await expect(service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', { contentSha256: second.content_sha256 })).rejects.toMatchObject({
        code: 'MKTG_APPROVED_CURRENT_CHANGED',
      });
      const latest = await service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', {});
      expect(latest?.summary.number).toBe(1);
    });

    it('finishes the exact exported revision when a later approved current disappears, retaining integrity checks', async () => {
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('First'), PROJECT, 'session-1');
      await approveStored(FRAMEWORK, 1);
      const started = await service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', {});
      if (!started) throw new Error('Missing synthetic export revision');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Second'), PROJECT, 'session-2');
      await approveStored(FRAMEWORK, 2);
      const [firstKey, secondKey] = revisionKeys();
      store.objects.delete(secondKey);

      await expect(service.getDocument(req, PROJECT, FRAMEWORK, 'living')).rejects.toMatchObject({ code: 'MKTG_APPROVED_REVISION_UNREADABLE' });
      expect(await service.readExportedRevision(req, PROJECT, FRAMEWORK, 'living', started.summary.id)).toMatchObject({
        id: started.summary.id,
        number: 1,
        contentSha256: started.summary.contentSha256,
      });
      const first = storedObject(firstKey);
      store.objects.set(firstKey, { ...first, body: 'corrupt synthetic revision' });
      expect(await service.readExportedRevision(req, PROJECT, FRAMEWORK, 'living', started.summary.id)).toBeNull();
      store.objects.delete(firstKey);
      expect(await service.readExportedRevision(req, PROJECT, FRAMEWORK, 'living', started.summary.id)).toBeNull();
    });

    it('exports the existing selected content after Make current without creating a copy', async () => {
      const first = jsonEnvelope('First');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, first, PROJECT, 'session-1');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Second'), PROJECT, 'session-2');
      const [firstKey, secondKey] = revisionKeys();
      await approveStored(FRAMEWORK, 1);
      await service.restoreRevision(req, PROJECT, FRAMEWORK, 'living', secondKey.split('/').pop()?.replace('.json', '') ?? '');
      await expect(service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', {})).rejects.toMatchObject({ code: 'MKTG_ASSET_NOT_APPROVED' });
      await service.restoreRevision(req, PROJECT, FRAMEWORK, 'living', firstKey.split('/').pop()?.replace('.json', '') ?? '');

      const bySha = await service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', { contentSha256: first.content_sha256 });

      expect(bySha?.summary).toMatchObject({ number: 1, origin: 'generated', latest: true });
      expect(revisionKeys()).toHaveLength(2);
    });

    it('refuses unapproved documents, stale explicit selectors and true pre-revision export fallback', async () => {
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Only'), PROJECT, 'session-1');

      await expect(service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', {})).rejects.toMatchObject({ code: 'MKTG_ASSET_NOT_APPROVED' });
      await approveStored(FRAMEWORK, 1);
      await expect(service.readExportRevision(req, PROJECT, FRAMEWORK, 'living', { contentSha256: 'f'.repeat(64) })).rejects.toMatchObject({
        code: 'MKTG_APPROVED_CURRENT_CHANGED',
      });
      seedLegacy('# Brand Kit\n');
      await expect(service.readExportRevision(req, PROJECT, BRAND_KIT, 'living', {})).rejects.toMatchObject({ code: 'MKTG_ASSET_NOT_APPROVED' });
    });
  });

  describe('readNewestRevisionRef — the last-export lookup’s latest revision', () => {
    it('reads the listing and the newest revision’s body alone', async () => {
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('First'), PROJECT, 'session-1');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Second'), PROJECT, 'session-2');
      const second = jsonEnvelope('Third');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, second, PROJECT, 'session-3');
      const getObject = vi.spyOn(ObjectStoreService.prototype, 'getObject');

      const newest = await service.readNewestRevisionRef(req, PROJECT, FRAMEWORK, 'living');

      expect(newest).toMatchObject({ number: 3, contentSha256: second.content_sha256 });
      expect(newest?.id).toBe(revisionKeys()[2].split('/').pop()?.replace('.json', ''));
      expect(getObject).toHaveBeenCalledTimes(2); // Current pointer plus one revision body.
      expect(getObject.mock.calls.filter(([, , key]) => /\/[0-9]{6}-[a-f0-9]{64}\.json$/.test(key))).toHaveLength(1);
      getObject.mockRestore();
    });

    it('skips every name lookup for freshness when author, selector and approver are the same actor', async () => {
      const envelope = jsonEnvelope('Approved content');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, envelope, PROJECT, 'session-1');
      await approveStored(FRAMEWORK, 1);
      const current = JSON.parse(storedObject(`documents/${PROJECT}/foundation-message/living/current.json`).body);
      expect(current.approvals[current.revisionId].approvedBy).toBe(current.changedBy);
      expect(storedObject(revisionKeys()[0]).metadata['author-id']).toBe(current.changedBy);
      // A new HTTP request must not reuse the names cached during generation/approval.
      const lookupRequest = Object.create(req) as Request;
      directoryMocks.getUserInfo.mockClear();
      directoryMocks.getUserInfo.mockImplementation(() => new Promise<never>(() => undefined));
      expect(await service.readNewestRevisionRef(lookupRequest, PROJECT, FRAMEWORK, 'living')).toMatchObject({
        number: 1,
        contentSha256: envelope.content_sha256,
      });
      expect(directoryMocks.getUserInfo).not.toHaveBeenCalled();
      directoryMocks.getUserInfo.mockResolvedValue({ success: true, data: { name: 'The writer' } });
      const detail = await service.getDocument(lookupRequest, PROJECT, FRAMEWORK, 'living');
      expect(detail?.revisions[0].author).toEqual({ name: 'The writer' });
      expect(detail?.current?.changedBy).toEqual({ name: 'The writer' });
      expect(detail?.revisions[0].approval?.approvedBy).toEqual({ name: 'The writer' });
      expect(directoryMocks.getUserInfo).toHaveBeenCalledExactlyOnceWith(lookupRequest, current.changedBy);
    });

    it('walks back past a newest revision that fails its integrity checks, and is null with nothing stored', async () => {
      expect(await service.readNewestRevisionRef(req, PROJECT, FRAMEWORK, 'living')).toBeNull();
      const first = jsonEnvelope('First');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, first, PROJECT, 'session-1');
      await service.persistJsonGeneration(req, FRAMEWORK_SPEC, jsonEnvelope('Second'), PROJECT, 'session-2');
      const tamperedKey = revisionKeys()[1];
      const tampered = store.objects.get(tamperedKey);
      store.objects.set(tamperedKey, { ...(tampered as { body: string; metadata: Record<string, string>; lastModified: Date }), body: '{"tampered":true}' });

      expect(await service.readNewestRevisionRef(req, PROJECT, FRAMEWORK, 'living')).toMatchObject({ number: 1, contentSha256: first.content_sha256 });
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

    it('returns stored LinkedIn card sidecars and LFX link answers after a fresh reader loads the run', async () => {
      const markdown = '# LinkedIn post options\n\nOriginal [LINK]\n';
      const generated = {
        ...envelope(markdown),
        options: [1, 2, 3].map((number) => ({
          number,
          label: `Angle ${number}`,
          text: `Original ${number} [LINK]`,
          word_count: 3,
          hashtags: ['#Code', '#Release', '#Community'],
          tagging_suggestions: ['Example project'],
        })),
        answers: { share_link: 'https://public.example/shared' },
      };
      const written = await service.recordGeneration(req, LINKEDIN, PROJECT, generated, 'session-link');
      const reloaded = new MktgDocumentStoreService();
      const response = await reloaded.getRevision(req, PROJECT, LINKEDIN, reloaded.runDocumentId('session-link'), written.id);
      expect(response?.markdown).toBe(markdown);
      expect(response?.linkedinPost).toMatchObject({ options: generated.options, answers: generated.answers });
      expect(response?.markdown).not.toContain('https://public.example/shared');
      expect(store.objects.get(written.key)?.metadata['author-id']).toBe('auth0|not-the-lfid');
      expect(JSON.stringify([...store.objects.values()])).not.toContain('The writer');
      expect(response?.linkedinPost).toMatchObject({ author: { name: 'The writer' }, isAuthor: true });
      expect(directoryMocks.getUserInfo).toHaveBeenCalledExactlyOnceWith(req, 'auth0|not-the-lfid');
      expect(JSON.stringify(response)).not.toContain('auth0|not-the-lfid');
      const originalBytes = store.objects.get(written.key)?.body;
      await service.saveLinkedinShareLink(req, PROJECT, reloaded.runDocumentId('session-link'), 'https://public.example/edited');
      const updated = await new MktgDocumentStoreService().getRevision(req, PROJECT, LINKEDIN, reloaded.runDocumentId('session-link'), written.id);
      expect(updated?.linkedinPost?.answers['share_link']).toBe('https://public.example/edited');
      expect(updated?.revisions).toHaveLength(1);
      expect(store.objects.get(written.key)?.body).toBe(originalBytes);
      expect(updated?.revision.contentSha256).toBe(response?.revision.contentSha256);
      await service.recordGeneration(req, LINKEDIN, PROJECT, generated, 'session-link');
      expect((await service.getRevision(req, PROJECT, LINKEDIN, reloaded.runDocumentId('session-link'), written.id))?.linkedinPost?.answers['share_link']).toBe(
        'https://public.example/edited'
      );
      const viewer = { oidc: { user: { sub: 'auth0|viewer' } } } as unknown as Request;
      expect((await service.getRevision(viewer, PROJECT, LINKEDIN, reloaded.runDocumentId('session-link'), written.id))?.linkedinPost).toMatchObject({
        isAuthor: false,
      });
      directoryMocks.getUserInfo.mockRejectedValueOnce(new Error('Synthetic directory outage'));
      const unavailable = { ...req } as Request;
      for (let index = 0; index < 2; index++) {
        expect((await service.getRevision(unavailable, PROJECT, LINKEDIN, reloaded.runDocumentId('session-link'), written.id))?.linkedinPost).toMatchObject({
          author: { name: null },
          isAuthor: true,
        });
      }
      expect(loggerMocks.warning.mock.calls.filter((call) => call[1] === 'mktg_document_store_author')).toHaveLength(1);
      directoryMocks.getUserInfo.mockResolvedValue({ success: true, username: 'not-a-display-name', data: {} });
      expect(
        (await service.getRevision({ ...req } as Request, PROJECT, LINKEDIN, reloaded.runDocumentId('session-link'), written.id))?.linkedinPost?.author
      ).toEqual({ name: null });
      const saved = store.objects.get(written.key);
      if (!saved) throw new Error('Expected stored test revision');
      delete saved.metadata['author-id'];
      expect((await service.getRevision(req, PROJECT, LINKEDIN, reloaded.runDocumentId('session-link'), written.id))?.linkedinPost).not.toHaveProperty(
        'author'
      );
    });
    it('seeds a late supplied link without freezing an omitted answer or overwriting a later explicit edit', async () => {
      const generated = {
        ...envelope('# Post [LINK]'),
        options: [1, 2, 3].map((number) => ({
          number,
          label: `Angle ${number}`,
          text: 'Post [LINK]',
          word_count: 2,
          hashtags: ['#Code', '#Release', '#Community'],
          tagging_suggestions: ['Example project'],
        })),
      };
      const written = await service.recordGeneration(req, LINKEDIN, PROJECT, generated, 'late-answers');
      const bytes = store.objects.get(written.key)?.body;
      const id = service.runDocumentId('late-answers');
      expect(written.record.bundle.sidecar).not.toHaveProperty('answers');
      await service.saveLinkedinShareLink(req, PROJECT, id, 'https://public.example/late', true);
      expect((await service.getRevision(req, PROJECT, LINKEDIN, id, written.id))?.linkedinPost?.answers['share_link']).toBe('https://public.example/late');
      await service.saveLinkedinShareLink(req, PROJECT, id, 'https://public.example/edited');
      await service.saveLinkedinShareLink(req, PROJECT, id, 'https://public.example/late', true);
      const result = await service.getRevision(req, PROJECT, LINKEDIN, id, written.id);
      expect(result?.linkedinPost?.answers['share_link']).toBe('https://public.example/edited');
      expect(result?.revisions).toHaveLength(1);
      expect(store.objects.get(written.key)?.body).toBe(bytes);
    });

    it('fails closed without an effective subject and refuses editing a missing run', async () => {
      await expect(service.recordGeneration({} as Request, LINKEDIN, PROJECT, envelope('# Post'), 'session-a')).rejects.toMatchObject({ statusCode: 401 });
      expect(store.objects.size).toBe(0);
      await expect(service.saveLinkedinShareLink(req, PROJECT, service.runDocumentId('missing'), '')).rejects.toMatchObject({ statusCode: 404 });
    });
    it('stores every run as its own document with a single revision that is never updated', async () => {
      await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Post A\n'), 'session-a');
      await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Post A, draft 2\n', 2), 'session-a');
      await service.recordGeneration(req, LINKEDIN, PROJECT, envelope('# Post B\n'), 'session-b');

      const group = (await service.listDocuments(req, PROJECT)).groups.find((candidate) => candidate.type.agentKey === 'linkedin-post');
      expect(group?.documents).toHaveLength(2);
      expect(group?.documents.map((document) => document.documentId).sort()).toEqual(['session-a', 'session-b'].map(buildMktgRunDocumentId).sort());
      expect(group?.documents.every((document) => document.revisionCount === 1 && /^run-[0-9a-f]{24}$/.test(document.documentId))).toBe(true);
    });
  });

  describe('reads', () => {
    it('rejects corrupt approved bytes without serving a different revision', async () => {
      await service.persistGeneration(req, SPEC, envelope('# First\n'), PROJECT, 'session-1');
      await service.persistGeneration(req, SPEC, envelope('# Second\n'), PROJECT, 'session-2');
      await approveStored(BRAND_KIT, 2);
      const tamperedKey = revisionKeys()[1];
      const tampered = store.objects.get(tamperedKey);
      store.objects.set(tamperedKey, { ...(tampered as { body: string; metadata: Record<string, string>; lastModified: Date }), body: '{"tampered":true}' });

      const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');

      // Metadata listings do not download or validate bodies. Opening validates
      // exactly that body, and a corrupted current never silently serves another.
      expect(detail?.revisions).toHaveLength(2);
      await expect(service.readLatest(req, SPEC, PROJECT)).rejects.toMatchObject({ code: 'MKTG_APPROVED_REVISION_UNREADABLE' });
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_document_store_read', expect.stringContaining('do not match'), expect.any(Object));
    });

    it('serves only pre-revision bytes when a newer managed compatibility artifact has no published revision', async () => {
      seedLegacy('# Old Brand Kit\n');
      store.failPutsMatching = /^documents\//;
      const draft = envelope('# Unapproved newer Draft\n');
      await expect(service.persistGeneration(req, SPEC, draft, PROJECT, 'failed-publish')).resolves.toBeNull();
      expect(storedObject(`brand-kit/${PROJECT}/${draft.content_sha256}.md`).metadata['revision-managed']).toBe('true');
      expect(revisionKeys()).toHaveLength(0);
      await expect(service.readLatest(req, SPEC, PROJECT)).resolves.toMatchObject({ documentMarkdown: '# Old Brand Kit\n', receipt: { version: 2 } });
    });

    describe('approved current plain/sidecar attachments', () => {
      const draft = (title: string): string => `# ${title}\n\n| Status | Draft — from your documents |\n`;

      it('serves approved current rather than a newer Draft, with matching plain/sidecar bytes', async () => {
        await service.persistGeneration(req, SPEC, envelope(draft('First'), 1), PROJECT, 'session-1');
        await service.persistGeneration(req, SPEC, envelope(draft('Newer draft'), 2), PROJECT, 'session-2');
        await approveStored(BRAND_KIT, 1);

        const latest = await service.readLatest(req, SPEC, PROJECT, { withSidecar: true });

        expect(latest?.documentMarkdown).toBe(draft('First'));
        expect(latest?.receipt.version).toBe(1);
        expect(latest?.revisionNumber).toBe(1);
        expect(latest?.storedAt).toBeTruthy();
        expect(latest?.sidecar).toMatchObject({ contract: 'brand-kit-output/v1', version: 1 });
        expect(latest?.sidecar).not.toHaveProperty('document_markdown');
        expect(latest).not.toHaveProperty('status');
        // Plain and sidecar reads share the same approved-current selection.
        const plain = await service.readLatest(req, SPEC, PROJECT);
        expect(plain?.documentMarkdown).toBe(draft('First'));
        expect(plain?.sidecar).toBeUndefined();
      });

      it('serves a JSON framework revision as the envelope it was stored from — the framework back under `content`, its own key as the receipt', async () => {
        const generated = jsonEnvelope('Search, open.');
        await service.persistJsonGeneration(req, FRAMEWORK_SPEC, generated, PROJECT, 'session-1');
        await approveStored(FRAMEWORK, 1);

        const latest = await service.readLatest(req, FRAMEWORK_SPEC, PROJECT, { withSidecar: true });

        expect(latest?.documentMarkdown).toBe(JSON.stringify(generated.content));
        expect(latest?.receipt.s3_key).toBe(revisionKeys()[0]);
        // The Brand Kit's framework reader unwraps `content`: the voice is there, with the report beside it.
        expect(latest?.sidecar).toMatchObject({
          contract: 'messaging-framework-output/v1',
          content: generated.content,
          report: { gaps: ['No member count.'] },
        });
        // The stored record is untouched: its sidecar still holds the rest of the envelope only.
        expect(storedRecord(revisionKeys()[0]).bundle.sidecar).not.toHaveProperty('content');
      });

      it('numbers the revision as the metadata-backed Documents listing without reading unrelated bodies', async () => {
        await service.persistGeneration(req, SPEC, envelope(draft('First'), 1), PROJECT, 'session-1');
        await service.persistGeneration(req, SPEC, envelope(draft('Broken'), 1), PROJECT, 'session-2');
        await service.persistGeneration(req, SPEC, envelope(draft('Second'), 1), PROJECT, 'session-3');
        await service.persistGeneration(req, SPEC, envelope(draft('Third'), 1), PROJECT, 'session-4');
        await approveStored(BRAND_KIT, 4);
        const tamperedKey = revisionKeys()[1];
        const tampered = store.objects.get(tamperedKey);
        store.objects.set(tamperedKey, { ...(tampered as { body: string; metadata: Record<string, string>; lastModified: Date }), body: '{"tampered":true}' });

        const latest = await service.readLatest(req, SPEC, PROJECT, { withSidecar: true });
        const detail = await service.getDocument(req, PROJECT, BRAND_KIT, 'living');

        expect(latest?.documentMarkdown).toBe(draft('Third'));
        expect(latest?.receipt.version).toBe(1);
        expect(latest?.revisionNumber).toBe(4);
        expect(detail?.revisions.find((revision) => revision.latest)?.number).toBe(4);
        // The plain attachment carries the same approved revision identity.
        expect((await service.readLatest(req, SPEC, PROJECT))?.revisionNumber).toBe(4);
      });

      it('is null when the document has no revision — the pre-revision document carries no sidecar and never stands in', async () => {
        seedLegacy('# Old Brand Kit\n');

        await expect(service.readLatest(req, SPEC, PROJECT, { withSidecar: true })).resolves.toBeNull();
      });

      it('is null, not the pre-revision document, when the only revision fails its integrity check', async () => {
        await service.persistGeneration(req, SPEC, envelope(draft('Only one'), 1), PROJECT, 'session-1');
        const tamperedKey = revisionKeys()[0];
        const tampered = store.objects.get(tamperedKey);
        store.objects.set(tamperedKey, { ...(tampered as { body: string; metadata: Record<string, string>; lastModified: Date }), body: '{"tampered":true}' });
        seedLegacy('# Old Brand Kit\n');

        await expect(service.readLatest(req, SPEC, PROJECT, { withSidecar: true })).resolves.toBeNull();
      });

      it('rejects, never resolves to null, when the store cannot list the revisions — an outage is not "no revision"', async () => {
        await service.persistGeneration(req, SPEC, envelope(draft('Only one'), 1), PROJECT, 'session-1');
        seedLegacy('# Old Brand Kit\n');
        store.failListsMatching = /^documents\//;

        await expect(service.readLatest(req, SPEC, PROJECT, { withSidecar: true })).rejects.toThrow('store unavailable');
        expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'mktg_document_store_read_latest', expect.stringContaining('rethrowing'), expect.any(Object));
        // Plain reads gate attachments too: an outage is not missing approval.
        await expect(service.readLatest(req, SPEC, PROJECT)).rejects.toThrow('store unavailable');
      });
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
