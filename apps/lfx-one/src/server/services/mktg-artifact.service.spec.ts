// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors brand-kit.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired
// into this app's vitest config with Angular-free resolution, so shared runtime
// collaborators are mocked — except the pure artifact utils and constants,
// re-exported through the mocks from their real (Angular-free) source modules
// so the spec exercises the real key-derivation logic.
const objectStoreMocks = vi.hoisted(() => ({
  putContentAddressedObject: vi.fn(),
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

vi.mock('@lfx-one/shared/utils', async () => vi.importActual('../../../../../packages/shared/src/utils/mktg-artifact.utils'));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => vi.importActual('../../../../../packages/shared/src/constants/mktg-artifact.constants'));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public putContentAddressedObject = objectStoreMocks.putContentAddressedObject;
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

import { MKTG_ARTIFACT_SPECS } from '@lfx-one/shared/constants';
import type { MktgArtifactEnvelope } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MktgArtifactService } from './mktg-artifact.service';

const req = { path: '/api/mktg-agents/foundation-message/result' } as unknown as Request;

/** The run's LFX project uid — the storage partition, resolved server-side. */
const PROJECT_UID = 'proj-uid-1';

const SPEC = MKTG_ARTIFACT_SPECS['foundation-message'];

const DOCUMENT = '# A Marketing OS document\n\nBody bytes that get content-addressed.';
const DOCUMENT_SHA = createHash('sha256').update(DOCUMENT, 'utf8').digest('hex');

function envelope(overrides: Partial<MktgArtifactEnvelope> = {}): MktgArtifactEnvelope {
  return {
    document_markdown: DOCUMENT,
    content_sha256: DOCUMENT_SHA,
    version: 1,
    intake: { mode: 'form' },
    ...overrides,
  };
}

/**
 * The ONE persistence layer every Marketing OS agent uses. These assert the
 * behaviour the Brand Kit proved (dec-brand-kit-storage-v2) as agent-agnostic
 * contract: the entitlement boundary, content-addressed keys, the
 * strictly-newer-draft metadata refresh, write-time ordering, and
 * degrade-to-null at WARN.
 */
describe('MktgArtifactService', () => {
  let service: MktgArtifactService;

  beforeEach(() => {
    vi.clearAllMocks();
    objectStoreMocks.putContentAddressedObject.mockResolvedValue(true);
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT_UID, slug: 'testorbit', writer: true });
    service = new MktgArtifactService();
  });

  describe('persist', () => {
    it('writes under the SERVER-resolved partition, with spec-driven prefix and per-agent log namespace', async () => {
      const receipt = await service.persist(req, SPEC, envelope(), PROJECT_UID);

      const expectedKey = `foundation-message/${PROJECT_UID}/${DOCUMENT_SHA}.md`;
      expect(projectMocks.getProjectById).toHaveBeenCalledWith(req, PROJECT_UID, true);
      const [, purpose, key, body, contentType, cacheControl, metadata] = objectStoreMocks.putContentAddressedObject.mock.calls[0];
      expect(purpose).toBe('marketing-os-artifacts');
      expect(key).toBe(expectedKey);
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(body.toString('utf8')).toBe(DOCUMENT);
      expect(contentType).toBe('text/markdown; charset=utf-8');
      expect(cacheControl).toBe('private');
      // Receipt fields ride as object metadata so the read path can rebuild the
      // receipt without re-parsing the envelope.
      expect(metadata).toEqual({ version: '1', 'intake-mode': 'form' });
      expect(receipt).toEqual({
        s3_key: expectedKey,
        content_sha256: DOCUMENT_SHA,
        project: PROJECT_UID,
        version: 1,
        intake_mode: 'form',
      });
      // Every agent's storage logs sit beside its existing generate/result lines.
      expect(loggerMocks.startOperation).toHaveBeenCalledWith(req, 'foundation_message_persist', expect.any(Object));
    });

    it('addresses each agent by its own spec — the same bytes land in different partitions', async () => {
      await service.persist(req, MKTG_ARTIFACT_SPECS['brand-kit'], envelope(), PROJECT_UID);
      await service.persist(req, MKTG_ARTIFACT_SPECS['icp'], envelope(), PROJECT_UID);

      expect(objectStoreMocks.putContentAddressedObject.mock.calls[0][2]).toBe(`brand-kit/${PROJECT_UID}/${DOCUMENT_SHA}.md`);
      expect(objectStoreMocks.putContentAddressedObject.mock.calls[1][2]).toBe(`icp/${PROJECT_UID}/${DOCUMENT_SHA}.md`);
      expect(loggerMocks.startOperation).toHaveBeenCalledWith(req, 'brand_kit_persist', expect.any(Object));
      expect(loggerMocks.startOperation).toHaveBeenCalledWith(req, 'icp_persist', expect.any(Object));
    });

    it('rewrites identical bytes only for a STRICTLY newer draft', async () => {
      await service.persist(req, SPEC, envelope({ version: 3 }), PROJECT_UID);

      const [, , , , , , , options] = objectStoreMocks.putContentAddressedObject.mock.calls[0];
      const refresh = options.refreshMetadataWhen as (stored: Record<string, string>) => boolean;
      // A later draft reproducing an earlier draft's bytes would otherwise be a
      // silent no-op, keeping the FIRST draft's label and write time — and the
      // read path orders by write time.
      expect(refresh({ version: '1', 'intake-mode': 'form' })).toBe(true);
      // Equal is not newer: the repeat write of every subsequent poll must stay
      // a HEAD-only no-op instead of re-uploading the document each tick.
      expect(refresh({ version: '3', 'intake-mode': 'form' })).toBe(false);
      // And a label never moves backwards when an older run re-emits the same
      // document (versions are per-run, so a second writer restarts at 1).
      expect(refresh({ version: '7', 'intake-mode': 'form' })).toBe(false);
      // An object stored before metadata existed counts as the documented
      // default (v1) — the oldest possible draft, never a newer one.
      expect(refresh({})).toBe(true);
    });

    it('refuses to write when the caller lacks the project writer grant', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT_UID, slug: 'testorbit', writer: false });

      await expect(service.persist(req, SPEC, envelope(), PROJECT_UID)).resolves.toBeNull();
      expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'foundation_message_persist', expect.stringContaining('writer grant'), expect.any(Object));
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });

    it('refuses to write with no project scope', async () => {
      await expect(service.persist(req, SPEC, envelope())).resolves.toBeNull();
      expect(projectMocks.getProjectById).not.toHaveBeenCalled();
      expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
    });

    it.each(['../projects/other', 'proj/../../admin', 'proj-uid-1?access=all', 'proj-uid-1#frag'])(
      'never spends the caller’s token resolving %j — a run scope is one path segment',
      async (scope) => {
        // `getProjectById` interpolates the uid unencoded into `/projects/{uid}`;
        // the shape gate runs BEFORE that request so a delimiter can never
        // reshape the authenticated upstream lookup.
        await expect(service.persist(req, SPEC, envelope(), scope)).resolves.toBeNull();
        expect(projectMocks.getProjectById).not.toHaveBeenCalled();
        expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
        expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'foundation_message_persist', expect.stringContaining('single-segment'), expect.any(Object));
        expect(loggerMocks.error).not.toHaveBeenCalled();
      }
    );

    it('never writes a partition the PROJECTS SERVICE reports as an unsafe segment', async () => {
      projectMocks.getProjectById.mockResolvedValue({ uid: 'resolved/unsafe', slug: 'testorbit', writer: true });

      await expect(service.persist(req, SPEC, envelope(), PROJECT_UID)).resolves.toBeNull();
      expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
    });

    it('refuses a document over the spec’s size cap — permanently, and without an ERROR', async () => {
      const small = { ...SPEC, maxDocumentBytes: 8 };

      await expect(service.persist(req, small, envelope(), PROJECT_UID)).resolves.toBeNull();
      expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'foundation_message_persist', expect.stringContaining('size cap'), expect.any(Object));
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });

    it('degrades a storage failure to null at WARN, never ERROR — the document is never blocked', async () => {
      objectStoreMocks.putContentAddressedObject.mockRejectedValue(new Error('storage down'));

      await expect(service.persist(req, SPEC, envelope(), PROJECT_UID)).resolves.toBeNull();
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'foundation_message_persist',
        expect.stringContaining('Object-store write failed'),
        expect.any(Object)
      );
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });

    it('degrades an unresolvable project to null at WARN, never ERROR', async () => {
      projectMocks.getProjectById.mockRejectedValue(new Error('project service unavailable'));

      await expect(service.persist(req, SPEC, envelope(), PROJECT_UID)).resolves.toBeNull();
      expect(objectStoreMocks.putContentAddressedObject).not.toHaveBeenCalled();
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });
  });

  describe('readLatest', () => {
    const key = `foundation-message/${PROJECT_UID}/${DOCUMENT_SHA}.md`;

    it('returns null without listing when the partition is not a single safe key segment', async () => {
      await expect(service.readLatest(req, SPEC, '../escape')).resolves.toBeNull();
      expect(objectStoreMocks.listObjects).not.toHaveBeenCalled();
    });

    it('lists the agent’s own partition and returns null when it holds nothing', async () => {
      objectStoreMocks.listObjects.mockResolvedValue([]);

      await expect(service.readLatest(req, SPEC, PROJECT_UID)).resolves.toBeNull();
      expect(objectStoreMocks.listObjects).toHaveBeenCalledWith(req, 'marketing-os-artifacts', `foundation-message/${PROJECT_UID}/`);
    });

    it('returns the newest content-addressed object with its receipt rebuilt from metadata', async () => {
      const olderDoc = 'An older stored document';
      const olderSha = createHash('sha256').update(olderDoc, 'utf8').digest('hex');
      objectStoreMocks.listObjects.mockResolvedValue([
        { key: `foundation-message/${PROJECT_UID}/${olderSha}.md`, lastModified: new Date('2026-08-01T00:00:00Z') },
        { key, lastModified: new Date('2026-08-15T00:00:00Z') },
        // Non-document keys in the partition are ignored, whatever their date.
        { key: `foundation-message/${PROJECT_UID}/notes.txt`, lastModified: new Date('2026-08-19T00:00:00Z') },
      ]);
      objectStoreMocks.getObject.mockResolvedValue({ body: DOCUMENT, metadata: { version: '3', 'intake-mode': 'conversational' } });

      const stored = await service.readLatest(req, SPEC, PROJECT_UID);

      expect(objectStoreMocks.getObject).toHaveBeenCalledOnce();
      expect(objectStoreMocks.getObject).toHaveBeenCalledWith(req, 'marketing-os-artifacts', key);
      expect(stored).toEqual({
        documentMarkdown: DOCUMENT,
        receipt: { s3_key: key, content_sha256: DOCUMENT_SHA, project: PROJECT_UID, version: 3, intake_mode: 'conversational' },
        storedAt: '2026-08-15T00:00:00.000Z',
      });
    });

    it('serves the most recently WRITTEN document even when an older object carries a higher draft version', async () => {
      // Regression guard for a tempting "fix": ordering this partition by the
      // envelope `version` in object metadata. Versions are scoped to one run,
      // while the partition is project-scoped and shared — a second writer, a
      // second browser or an expired stored run restarts at 1. Ordering by
      // version would let a stale v5 outrank every later document, forever.
      const staleDoc = 'Stored months ago by another writer, revised five times';
      const staleSha = createHash('sha256').update(staleDoc, 'utf8').digest('hex');
      objectStoreMocks.listObjects.mockResolvedValue([
        { key: `foundation-message/${PROJECT_UID}/${staleSha}.md`, lastModified: new Date('2026-06-01T00:00:00Z') },
        { key, lastModified: new Date('2026-08-15T00:00:00Z') },
      ]);
      objectStoreMocks.getObject.mockResolvedValue({ body: DOCUMENT, metadata: { version: '1', 'intake-mode': 'form' } });

      const stored = await service.readLatest(req, SPEC, PROJECT_UID);

      expect(objectStoreMocks.getObject).toHaveBeenCalledOnce();
      expect(stored?.receipt.s3_key).toBe(key);
      expect(stored?.receipt.version).toBe(1);
    });

    it('defaults version/intake_mode for objects persisted before metadata was written', async () => {
      objectStoreMocks.listObjects.mockResolvedValue([{ key, lastModified: new Date('2026-08-15T00:00:00Z') }]);
      objectStoreMocks.getObject.mockResolvedValue({ body: DOCUMENT, metadata: {} });

      const stored = await service.readLatest(req, SPEC, PROJECT_UID);

      expect(stored?.receipt.version).toBe(1);
      expect(stored?.receipt.intake_mode).toBe('form');
    });

    it('skips an object whose bytes do not hash to its content-addressed key and serves the next candidate', async () => {
      const tamperedKey = `foundation-message/${PROJECT_UID}/${'a'.repeat(64)}.md`;
      objectStoreMocks.listObjects.mockResolvedValue([
        { key: tamperedKey, lastModified: new Date('2026-08-16T00:00:00Z') },
        { key, lastModified: new Date('2026-08-15T00:00:00Z') },
      ]);
      objectStoreMocks.getObject.mockResolvedValueOnce({ body: 'tampered bytes', metadata: { version: '9', 'intake-mode': 'form' } });
      objectStoreMocks.getObject.mockResolvedValueOnce({ body: DOCUMENT, metadata: { version: '2', 'intake-mode': 'form' } });

      const stored = await service.readLatest(req, SPEC, PROJECT_UID);

      expect(loggerMocks.warning).toHaveBeenCalledWith(req, 'foundation_message_stored', expect.stringContaining('do not match'), expect.any(Object));
      expect(stored?.receipt.content_sha256).toBe(DOCUMENT_SHA);
      expect(stored?.receipt.version).toBe(2);
    });

    it('reads the exact partition the write path wrote to — a persisted document is never invisible to its project', async () => {
      const receipt = await service.persist(req, SPEC, envelope(), PROJECT_UID);
      objectStoreMocks.listObjects.mockResolvedValue([{ key: receipt?.s3_key as string, lastModified: new Date('2026-08-20T00:00:00Z') }]);
      objectStoreMocks.getObject.mockResolvedValue({ body: DOCUMENT, metadata: { version: '1', 'intake-mode': 'form' } });

      const stored = await service.readLatest(req, SPEC, PROJECT_UID);

      const [, , listedPrefix] = objectStoreMocks.listObjects.mock.calls[0];
      expect((receipt?.s3_key as string).startsWith(listedPrefix)).toBe(true);
      expect(stored?.receipt.s3_key).toBe(receipt?.s3_key);
    });

    it('degrades a storage failure to null at WARN (graceful degradation), never ERROR', async () => {
      objectStoreMocks.listObjects.mockRejectedValue(new Error('bucket unreachable'));

      await expect(service.readLatest(req, SPEC, PROJECT_UID)).resolves.toBeNull();
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'foundation_message_stored',
        expect.stringContaining('Object-store read failed'),
        expect.any(Object)
      );
      expect(loggerMocks.error).not.toHaveBeenCalled();
    });
  });
});
