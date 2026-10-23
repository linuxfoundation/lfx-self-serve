// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The export runs end to end against the REAL document store over an
// in-memory object store (the create-if-absent, list-by-prefix and get
// semantics every backend serves, plus the public image upload), with the
// Guild API mocked: what the exporter is sent, and what its session holds.
// Shared runtime modules are re-exported from their real (Angular-free)
// source files; only the framework's content reader is reduced to "has a
// message house", which is all the export needs of it.
const store = vi.hoisted(() => ({
  objects: new Map<string, { body: string; metadata: Record<string, string>; lastModified: Date }>(),
  publicImages: new Map<string, Buffer>(),
  clock: 0,
  failPublicPut: false,
}));
const guildMocks = vi.hoisted(() => ({ createSession: vi.fn(), getRawEventPayloads: vi.fn() }));
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
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-rebuild.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-envelope.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/brand-kit.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-slides-export.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-family-export.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/boilerplates.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/faq.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-run-failure.utils')),
  readFoundationMessageContent: (text: string): unknown => {
    try {
      const value = JSON.parse(text) as Record<string, unknown>;
      return value && typeof value['mh'] === 'object' ? value : null;
    } catch {
      return null;
    }
  },
}));
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-document-store.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-kit.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-rebuild.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-asset.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/brand-kit.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-slides-export.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-family-export.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-kit.constants')),
}));
vi.mock('./logger.service', () => ({ logger: loggerMocks }));
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
      if (store.objects.has(key)) {
        return false;
      }
      store.clock += 1000;
      store.objects.set(key, { body: body.toString('utf8'), metadata: metadata ?? {}, lastModified: new Date(store.clock) });
      return true;
    }
    public async headObject(_req: unknown, _purpose: string, key: string): Promise<Record<string, string> | null> {
      return store.objects.get(key)?.metadata ?? null;
    }
    public async putConditionalObject(
      _req: unknown,
      _purpose: string,
      key: string,
      input: { body: Buffer; metadata?: Record<string, string>; ifMatch?: string; ifNoneMatch?: string }
    ): Promise<boolean> {
      const previous = store.objects.get(key);
      if ((input.ifNoneMatch && previous) || (input.ifMatch && (!previous || input.ifMatch !== String(previous.lastModified.getTime())))) {
        return false;
      }
      store.clock += 1000;
      store.objects.set(key, { body: input.body.toString('utf8'), metadata: input.metadata ?? {}, lastModified: new Date(store.clock) });
      return true;
    }
    public async listObjects(_req: unknown, _purpose: string, prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
      return [...store.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async getObject(_req: unknown, _purpose: string, key: string): Promise<{ body: string; metadata: Record<string, string>; etag: string } | null> {
      const object = store.objects.get(key);
      return object ? { body: object.body, metadata: object.metadata, etag: String(object.lastModified.getTime()) } : null;
    }
    public async putPublicImage(_req: unknown, key: string, buffer: Buffer): Promise<{ url: string | null }> {
      if (store.failPublicPut) {
        throw new Error('bucket unavailable');
      }
      store.publicImages.set(key, buffer);
      return { url: `https://cdn.example.test/${key}` };
    }
  },
}));

import { MKTG_ARTIFACT_SPECS, MKTG_DOCUMENT_TYPES, MKTG_SLIDES_EXPORT_POLL } from '@lfx-one/shared/constants';
import type { MktgDocumentType, MktgSlidesExportStartInput } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { isMktgSlidesExportStale } from '../../../../../packages/shared/src/utils/mktg-slides-export.utils';
import { MKTG_SLIDES_EXPORT_DEFAULT_FOLDER_ID } from '../constants';
import { ConflictError } from '../errors';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { MktgSlidesExportService } from './mktg-slides-export.service';
import { ObjectStoreService } from './object-store.service';

const req = {
  path: '/api/mktg-agents/slides-export/start',
  oidc: { user: { sub: 'auth0|synthetic-export-writer' } },
} as unknown as Request;
const PROJECT = 'proj-uid-1';
const DECK_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz';
const BRAND_KIT = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'brand-kit') as MktgDocumentType;
const FRAMEWORK = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'foundation-message') as MktgDocumentType;

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The width and height a PNG's IHDR chunk names, or null when the bytes are not a PNG. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Store a Brand Kit revision as the brand-kit run does: its Markdown, the rest of the envelope as the sidecar. */
async function approveNewest(documentStore: MktgDocumentStoreService, type: MktgDocumentType): Promise<void> {
  const revision = (await documentStore.getDocument(req, PROJECT, type, 'living'))?.revisions[0];
  if (!revision) throw new Error('Missing synthetic revision');
  await documentStore.approveRevision(req, PROJECT, type, 'living', revision.id);
}

async function seedKit(documentStore: MktgDocumentStoreService, options: { svg?: string | null; placeholder?: boolean } = {}): Promise<void> {
  const kit = brandKitTestRevision();
  if (options.svg !== undefined) {
    kit.chapters.logo.files.primary = options.svg === null ? null : { ref: 'logo.svg', svg: options.svg };
  }
  if (options.placeholder !== undefined) {
    kit.chapters.logo.placeholder = options.placeholder;
  }
  const markdown = `# ${kit.projectName} Brand Kit\n`;
  const receipt = await documentStore.persistGeneration(
    req,
    MKTG_ARTIFACT_SPECS['brand-kit'],
    {
      contract: 'brand-kit-output/v2',
      kind: 'brand-kit',
      project: kit.project,
      project_name: kit.projectName,
      version: 1,
      mode: kit.mode,
      document_markdown: markdown,
      content_sha256: sha(markdown),
      kit: kit.kit,
      chapters: kit.chapters,
      report: kit.report,
      inputs: { website_url: kit.websiteUrl },
      generated_at: kit.generatedAt,
      agent: { identifier: 'linux-foundation~brand-kit', agent_version: kit.agentVersion },
      intake: { mode: 'form' },
    } as never,
    PROJECT,
    `kit-session-${store.clock}`
  );
  expect(receipt).toMatchObject({ project: PROJECT, content_sha256: sha(markdown) });
  await approveNewest(documentStore, BRAND_KIT);
}

/** Store a Messaging Framework revision; returns its content hash. */
async function seedFramework(documentStore: MktgDocumentStoreService, tagline = 'Search, open.', approved = true): Promise<string> {
  const content = { mf: { tagline }, icp: [], mh: { umbrella: 'Open search.', pillars: [] }, nums: [] };
  const contentSha = sha(JSON.stringify(content));
  const receipt = await documentStore.persistJsonGeneration(
    req,
    MKTG_ARTIFACT_SPECS['foundation-message'],
    { contract: 'messaging-framework-output/v1', content, content_sha256: contentSha, version: 1, mode: 'draft', intake: { mode: 'form' } } as never,
    PROJECT,
    `framework-session-${tagline}`
  );
  expect(receipt).toMatchObject({ project: PROJECT, content_sha256: contentSha });
  if (approved) await approveNewest(documentStore, FRAMEWORK);
  return contentSha;
}

function input(overrides: Partial<MktgSlidesExportStartInput> = {}): MktgSlidesExportStartInput {
  return {
    project: PROJECT,
    projectName: 'Example\nProject',
    type: FRAMEWORK,
    agentKey: 'foundation-message',
    documentId: 'living',
    selector: {},
    mode: 'create',
    ...overrides,
  };
}

/** The exporter's envelope as its final output (an agent_notification_message carrying `content.data`). */
function outputEvent(overrides: { mode?: 'create' | 'update'; deckId?: string; tamper?: boolean } = {}): string {
  const deckId = overrides.deckId ?? DECK_ID;
  const content = {
    assets: ['framework', 'kit'],
    slides: [{ index: 1, kind: 'title', layout: 'TITLE', title: 'Example Project', object_id: 'sx1_s01' }],
    branded: { kit: true, logo: false, backgrounds: 5, text_colors: 2, fonts: 15, bars: 2, logos: 0, logos_skipped: 0, tables_header: '#4D4E4E' },
  };
  const envelope = {
    contract: 'slides-export-output/v1',
    kind: 'slides-export',
    project: 'example-project',
    project_name: 'Example Project',
    mode: overrides.mode ?? 'create',
    deck: {
      id: deckId,
      link: `https://docs.google.com/presentation/d/${deckId}/edit`,
      title: 'Example Project · Messaging framework · 2026-10-19',
      folder_id: MKTG_SLIDES_EXPORT_DEFAULT_FOLDER_ID,
    },
    slide_count: 12,
    content,
    content_sha256: overrides.tamper ? 'f'.repeat(64) : sha(JSON.stringify(content)),
    generated_at: '2026-10-19T10:00:00.000Z',
    agent: { identifier: 'linux-foundation~slides-export', agent_version: '1.0.2' },
  };
  return JSON.stringify({ type: 'agent_notification_message', created_at: '2026-10-19T10:00:00Z', content: { type: 'text', data: JSON.stringify(envelope) } });
}

function sentMessage(): string {
  return (guildMocks.createSession.mock.calls.at(-1)?.[1] as { message: string }).message;
}

describe('MktgSlidesExportService', () => {
  let service: MktgSlidesExportService;
  let documentStore: MktgDocumentStoreService;

  beforeEach(() => {
    vi.clearAllMocks();
    store.objects.clear();
    store.publicImages.clear();
    store.clock = 0;
    store.failPublicPut = false;
    projectMocks.getProjectById.mockResolvedValue({ uid: PROJECT, writer: true });
    directoryMocks.getUserInfo.mockResolvedValue({ success: true, data: { name: 'The writer' } });
    guildMocks.createSession.mockResolvedValue('session-1');
    guildMocks.getRawEventPayloads.mockResolvedValue([]);
    service = new MktgSlidesExportService();
    documentStore = new MktgDocumentStoreService();
    // Every start polls its session to the end on the server: its timers are
    // the test's to run, and never reach into the next test.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('family exports', () => {
    const familyInput = { project: PROJECT, projectName: 'Synthetic project', familyId: 'positioning-brand', mode: 'create' as const };

    it('refuses a family with no approved members without calling Guild', async () => {
      await seedFramework(documentStore, 'Draft only.', false);
      await expect(service.startFamilyExport(req, familyInput)).rejects.toMatchObject({ statusCode: 409, code: 'FAMILY_NOTHING_APPROVED' });
      expect(guildMocks.createSession).not.toHaveBeenCalled();
    });

    it('composes every approved family asset in deck order with the full kit and skips only unapproved members', async () => {
      await seedFramework(documentStore);
      await seedKit(documentStore);
      const bp = ['One-liner', '25 words', '50 words', '100 words'].map((l, index) => ({ l, max: [15, 25, 50, 100][index], t: 'Synthetic boilerplate.' }));
      const faq = [
        [
          'General',
          [
            ['What is this project?', 'A synthetic project.', null],
            ['Unanswered?', null, null],
          ],
        ],
      ];
      for (const [agentKey, content] of [
        ['boilerplates', { bp }],
        ['faq', { faq }],
      ] as const) {
        const type = MKTG_DOCUMENT_TYPES.find((candidate) => candidate.agentKey === agentKey);
        if (!type) throw new Error('Synthetic type missing');
        await documentStore.recordGeneration(
          req,
          type,
          PROJECT,
          {
            text: JSON.stringify(content),
            format: 'json',
            contentSha256: sha(JSON.stringify(content)),
            version: 1,
            intakeMode: 'form',
            sidecar: null,
          },
          `synthetic-${agentKey}`
        );
        await approveNewest(documentStore, type);
      }
      await service.startExport(req, input({ type: BRAND_KIT, agentKey: 'brand-kit' }));
      const documentKit = JSON.parse(sentMessage().split('--- ASSETS (JSON) ---\n')[1].split('\n--- END ASSETS ---')[0]).kit;
      const started = await service.startFamilyExport(req, familyInput);
      expect(started.skippedMembers).toEqual([]);
      expect(started.snapshot.members.map((member) => member.agentKey)).toEqual(['foundation-message', 'brand-kit', 'boilerplates', 'faq']);
      expect(sentMessage()).toContain('ASSETS: framework, kit, boilerplates, faq');
      const assets = JSON.parse(sentMessage().split('--- ASSETS (JSON) ---\n')[1].split('\n--- END ASSETS ---')[0]);
      expect(assets.kit).toHaveProperty('chapters');
      expect(assets.kit).toHaveProperty('kit');
      expect(assets.kit).toEqual(documentKit);
      expect(assets.boilerplates).toEqual(bp);
      expect(assets.faq).toEqual([{ q: 'What is this project?', a: 'A synthetic project.' }]);
    });

    it('refuses an unreadable approved asset with family-specific copy before calling Guild', async () => {
      await documentStore.recordGeneration(
        req,
        FRAMEWORK,
        PROJECT,
        {
          text: '{}',
          format: 'json',
          contentSha256: sha('{}'),
          version: 1,
          intakeMode: 'form',
          sidecar: null,
        },
        'synthetic-unreadable-framework'
      );
      await approveNewest(documentStore, FRAMEWORK);
      await expect(service.startFamilyExport(req, familyInput)).rejects.toMatchObject({ statusCode: 409, code: 'FAMILY_ASSET_UNREADABLE' });
      expect(guildMocks.createSession).not.toHaveBeenCalled();
    });

    it('refuses an approved FAQ with no exportable answers rather than sending an exporter-invalid empty list', async () => {
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'faq');
      if (!type) throw new Error('Synthetic FAQ type missing');
      const text = JSON.stringify({ faq: [['General', [['Unanswered?', null, null]]]] });
      await documentStore.recordGeneration(
        req,
        type,
        PROJECT,
        {
          text,
          format: 'json',
          contentSha256: sha(text),
          version: 1,
          intakeMode: 'form',
          sidecar: null,
        },
        'synthetic-unanswered-faq'
      );
      await approveNewest(documentStore, type);
      await expect(service.startFamilyExport(req, familyInput)).rejects.toMatchObject({ statusCode: 409, code: 'FAMILY_ASSET_UNREADABLE' });
      expect(guildMocks.createSession).not.toHaveBeenCalled();
    });

    it('keeps exact started revisions after approval moves, independently of document exports', async () => {
      await seedFramework(documentStore);
      const started = await service.startFamilyExport(req, familyInput);
      expect(started.skippedMembers).toEqual(['brand-kit', 'boilerplates', 'faq']);
      await seedFramework(documentStore, 'New approved.');
      expect(await service.getFamilyResult(req, started.sessionId, started.snapshot)).toEqual({ status: 'pending' });
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      const ready = await service.getFamilyResult(req, started.sessionId, started.snapshot);
      expect(ready).toMatchObject({ status: 'ready', record: { familyId: 'positioning-brand', members: started.snapshot.members } });
      await service.getFamilyResult(req, started.sessionId, started.snapshot);
      const records = [...store.objects.keys()].filter((key) => key.startsWith('slides-exports/'));
      expect(records).toHaveLength(1);
      expect(records[0]).toContain('/families/positioning-brand/');
      expect((await service.getFamilyLast(req, PROJECT, familyInput.familyId)).stale).toBe(true);
      expect((await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living')).last).toBeNull();
    });

    it.each(['family', 'document'] as const)('records a finished %s export on A when a later approved B disappears', async (scope) => {
      await seedFramework(documentStore);
      const family = scope === 'family' ? await service.startFamilyExport(req, familyInput) : null;
      const document = scope === 'document' ? await service.startExport(req, input()) : null;
      const startedId = family?.snapshot.members[0]?.revisionId ?? document?.revision.id;
      expect(startedId).toBeTruthy();
      await seedFramework(documentStore, 'New approved.');
      const current = (await documentStore.getDocument(req, PROJECT, FRAMEWORK, 'living'))?.approvedCurrent;
      if (!current) throw new Error('Missing synthetic approval');
      expect(current.revisionId).not.toBe(startedId);
      const key = `documents/${PROJECT}/foundation-message/living/${current.revisionId}.json`;
      expect(store.objects.delete(key)).toBe(true);

      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      if (family) {
        expect(await service.getFamilyResult(req, family.sessionId, family.snapshot)).toMatchObject({
          status: 'ready',
          record: { deckId: DECK_ID, members: family.snapshot.members },
        });
      }
      if (document) {
        const context = { project: PROJECT, type: FRAMEWORK, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: document.revision.id };
        expect(await service.getResult(req, document.sessionId, context)).toMatchObject({
          status: 'ready',
          record: { deckId: DECK_ID, revisionId: startedId, revisionNumber: 1 },
        });
        await expect(service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living')).rejects.toMatchObject({
          statusCode: 502,
          code: 'MKTG_APPROVED_REVISION_UNREADABLE',
        });
      }
      const records = [...store.objects.entries()].filter(([key]) => key.startsWith('slides-exports/'));
      expect(records).toHaveLength(1);
      expect(JSON.parse(records[0][1].body)).toMatchObject({ deckId: DECK_ID });
      if (document) expect(JSON.parse(records[0][1].body)).toMatchObject({ revisionId: startedId, revisionNumber: 1 });
      await expect(service.getFamilyLast(req, PROJECT, familyInput.familyId)).rejects.toMatchObject({
        statusCode: 502,
        code: 'MKTG_APPROVED_REVISION_UNREADABLE',
      });
    });

    it('reads approved identities without loading revision bodies, even when an approved body is corrupt', async () => {
      await seedFramework(documentStore);
      const started = await service.startFamilyExport(req, familyInput);
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await service.getFamilyResult(req, started.sessionId, started.snapshot);
      const member = started.snapshot.members[0];
      if (!member) throw new Error('Missing synthetic member');
      const key = `documents/${PROJECT}/${member.agentKey}/living/${member.revisionId}.json`;
      const stored = store.objects.get(key);
      if (!stored) throw new Error('Missing synthetic revision');
      stored.body = 'unreadable approved revision';
      const exportRead = vi.spyOn(MktgDocumentStoreService.prototype, 'readExportRevision');
      const objectRead = vi.spyOn(ObjectStoreService.prototype, 'getObject');
      const last = await service.getFamilyLast(req, PROJECT, familyInput.familyId);
      expect(last.currentMembers).toEqual(started.snapshot.members);
      expect(last.last?.deckId).toBe(DECK_ID);
      expect(last.stale).toBe(false);
      expect(exportRead).not.toHaveBeenCalled();
      expect(objectRead.mock.calls.some((call) => call[2] === key)).toBe(false);
      exportRead.mockRestore();
      objectRead.mockRestore();
      await expect(service.startFamilyExport(req, familyInput)).rejects.toMatchObject({ code: 'MKTG_APPROVED_REVISION_UNREADABLE' });
    });

    it.each([false, true])('fails start and freshness when an approved object disappears (other approved member=%s)', async (withKit) => {
      await seedFramework(documentStore);
      if (withKit) await seedKit(documentStore);
      const started = await service.startFamilyExport(req, familyInput);
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await service.getFamilyResult(req, started.sessionId, started.snapshot);
      const member = started.snapshot.members[0];
      if (!member) throw new Error('Missing synthetic member');
      store.objects.delete(`documents/${PROJECT}/${member.agentKey}/living/${member.revisionId}.json`);
      guildMocks.createSession.mockClear();
      const failure = { statusCode: 502, code: 'MKTG_APPROVED_REVISION_UNREADABLE' };
      for (const mode of ['create', 'update'] as const) {
        await expect(service.startFamilyExport(req, { ...familyInput, mode })).rejects.toMatchObject(failure);
      }
      await expect(service.getFamilyLast(req, PROJECT, familyInput.familyId)).rejects.toMatchObject(failure);
      expect(guildMocks.createSession).not.toHaveBeenCalled();
      expect([...store.objects.keys()].filter((key) => key.startsWith('slides-exports/'))).toHaveLength(1);
    });

    it('drafts do not stale the export; newly approved members do', async () => {
      await seedFramework(documentStore);
      const started = await service.startFamilyExport(req, familyInput);
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await service.getFamilyResult(req, started.sessionId, started.snapshot);
      await seedFramework(documentStore, 'New draft.', false);
      expect((await service.getFamilyLast(req, PROJECT, familyInput.familyId)).stale).toBe(false);
      await seedKit(documentStore);
      expect((await service.getFamilyLast(req, PROJECT, familyInput.familyId)).stale).toBe(true);
    });

    it('updates the family last deck, creates a new one on request, and does not trust a mismatching result', async () => {
      await seedFramework(documentStore);
      const read = vi.spyOn(MktgDocumentStoreService.prototype, 'readExportRevision');
      await expect(service.startFamilyExport(req, { ...familyInput, mode: 'update' })).rejects.toMatchObject({ code: 'NO_DECK_TO_UPDATE' });
      expect(read).not.toHaveBeenCalled();
      read.mockRestore();
      const first = await service.startFamilyExport(req, familyInput);
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await service.getFamilyResult(req, first.sessionId, first.snapshot);
      const update = await service.startFamilyExport(req, { ...familyInput, mode: 'update' });
      expect(sentMessage()).toContain(`DECK ID: ${DECK_ID}`);
      expect(update.snapshot.deckId).toBe(DECK_ID);
      expect(await service.getFamilyResult(req, update.sessionId, update.snapshot)).toMatchObject({ status: 'failed' });
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent({ mode: 'update' })]);
      expect(await service.getFamilyResult(req, update.sessionId, update.snapshot)).toMatchObject({
        status: 'ready',
        record: { mode: 'update', deckId: DECK_ID },
      });
      await service.startFamilyExport(req, familyInput);
      expect(sentMessage()).toContain('DECK ID: none (create a new deck');
    });

    it('finishes and keeps family exports even when the browser leaves', async () => {
      await seedFramework(documentStore);
      await service.startFamilyExport(req, familyInput);
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
      expect((await service.getFamilyLast(req, PROJECT, familyInput.familyId)).last?.deckId).toBe(DECK_ID);
    });
  });

  describe('startExport', () => {
    it('sends the stored framework with the project’s kit tokens to the Marketing OS folder, the mention on its own line', async () => {
      await seedKit(documentStore);
      await seedFramework(documentStore);

      const started = await service.startExport(req, input());

      expect(started).toMatchObject({ sessionId: 'session-1', mode: 'create', revision: { number: 1 } });
      const call = guildMocks.createSession.mock.calls[0][1] as { handle: string; mentionOnOwnLine: boolean };
      expect(call).toMatchObject({ handle: 'slides-export', mentionOnOwnLine: true });
      const lines = sentMessage().split('\n');
      expect(lines[0]).toBe('BATCH INTAKE SUBMISSION (Slides export)');
      expect(lines[1]).toBe('PROJECT NAME: Example Project');
      expect(lines[3]).toBe(`FOLDER ID: ${MKTG_SLIDES_EXPORT_DEFAULT_FOLDER_ID}`);
      expect(lines[4]).toBe('DECK ID: none (create a new deck from the LF 2025 template)');
      expect(lines[5]).toMatch(/^DECK TITLE: Example Project · Messaging framework · \d{4}-\d{2}-\d{2}$/);
      expect(lines[7]).toBe('ASSETS: framework, kit');
      const assets = JSON.parse(sentMessage().split('--- ASSETS (JSON) ---\n')[1].split('\n--- END ASSETS ---')[0]) as Record<string, Record<string, unknown>>;
      expect(assets['framework']['mh']).toEqual({ umbrella: 'Open search.', pillars: [] });
      expect(assets['kit']).toMatchObject({ dark: '#4D4E4E', accent: '#F37625', font: 'Montserrat' });
      // No public image URL in this environment: the logo is not sent, and the start says why.
      expect(lines[6]).toBe('LOGO URL: none');
      expect(started.logoNote).toBe('not-public');
      expect(store.publicImages.size).toBe(0);
    });

    it('creates the deck in the folder the environment names, so a test environment keeps its decks out of the Marketing OS folder', async () => {
      vi.stubEnv('MKTG_SLIDES_EXPORT_FOLDER_ID', ' 1TestFolderForStagingDecks ');
      await seedFramework(documentStore);

      await service.startExport(req, input());

      expect(sentMessage()).toContain('\nFOLDER ID: 1TestFolderForStagingDecks\n');
    });

    it('sends the stored kit with its chapters on a brand kit export, so the deck lays out the whole book', async () => {
      await seedKit(documentStore);

      await service.startExport(req, input({ type: BRAND_KIT, agentKey: 'brand-kit' }));

      expect(sentMessage()).toContain('\nASSETS: kit\n');
      const assets = JSON.parse(sentMessage().split('--- ASSETS (JSON) ---\n')[1].split('\n--- END ASSETS ---')[0]) as Record<string, Record<string, unknown>>;
      expect(assets['kit']['kit']).toMatchObject({ dark: '#4D4E4E', accent: '#F37625', font: 'Montserrat' });
      expect(Object.keys(assets['kit']['chapters'] as object)).toEqual(expect.arrayContaining(['logo', 'color', 'type', 'visual', 'usage', 'voice']));
      expect(assets['kit']).toMatchObject({ projectName: expect.any(String), version: expect.any(Number) });
    });

    it("exports a framework in the LF look when the project's kit cannot be read, instead of failing", async () => {
      await seedFramework(documentStore);
      const readLatest = vi.spyOn(MktgDocumentStoreService.prototype, 'readLatest').mockRejectedValueOnce(new Error('store unavailable'));

      const started = await service.startExport(req, input());

      expect(readLatest).toHaveBeenCalled();
      expect(sentMessage()).toContain('\nASSETS: framework\n');
      expect(started.logoNote).toBe('no-logo');
    });

    it('exports a framework without a kit in the LF look', async () => {
      await seedFramework(documentStore);

      const started = await service.startExport(req, input());

      expect(sentMessage()).toContain('\nASSETS: framework\n');
      expect(started.logoNote).toBe('no-logo');
    });

    it('draws the stored kit’s SVG logo as a PNG, publishes it to the public image bucket and sends its URL', async () => {
      vi.stubEnv('CDN_URL_PREFIX', 'https://cdn.example.test');
      await seedKit(documentStore);

      const started = await service.startExport(req, input({ type: BRAND_KIT, agentKey: 'brand-kit' }));

      const [[key, published]] = [...store.publicImages.entries()];
      expect(key).toMatch(new RegExp(`^mktg-slides-logos/${PROJECT}/[0-9a-f]{64}\\.png$`));
      // The test kit's logo is a 10 x 3 viewBox: drawn with its longest side at the drawing size.
      expect(pngSize(published)).toEqual({ width: 1200, height: 360 });
      expect(sentMessage()).toContain(`\nLOGO URL: https://cdn.example.test/${key}\n`);
      expect(sentMessage()).toContain('\nASSETS: kit\n');
      expect(sentMessage()).toMatch(/\nDECK TITLE: Example Project · Brand kit · /);
      expect(started.logoNote).toBeNull();
    });

    it('sends no logo, and says why, when the SVG reaches outside itself, sets live text, cannot be drawn, or cannot be published', async () => {
      vi.stubEnv('CDN_URL_PREFIX', 'https://cdn.example.test');
      const kitInput = input({ type: BRAND_KIT, agentKey: 'brand-kit' });

      await seedKit(documentStore, {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"><image href="/etc/logo.png" width="10" height="3"/></svg>',
      });
      expect((await service.startExport(req, kitInput)).logoNote).toBe('not-drawn');
      await seedKit(documentStore, { svg: 'not an svg' });
      expect((await service.startExport(req, kitInput)).logoNote).toBe('not-drawn');
      // Live text draws as nothing on the fontless server: the deck keeps the template's logo, and the panel says why.
      await seedKit(documentStore, {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"><text x="0" y="2" font-size="2">Orbit</text></svg>',
      });
      expect((await service.startExport(req, kitInput)).logoNote).toBe('live-text');
      expect(store.publicImages.size).toBe(0);
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'mktg_slides_export_logo',
        expect.any(String),
        expect.objectContaining({ reason: 'unreadable', svg_chars: 'not an svg'.length })
      );

      await seedKit(documentStore);
      store.failPublicPut = true;
      expect((await service.startExport(req, kitInput)).logoNote).toBe('not-published');
      expect(sentMessage()).toContain('\nLOGO URL: none\n');
    });

    it('says the kit has no logo when its primary logo is not an SVG', async () => {
      await seedKit(documentStore, { svg: null });

      expect((await service.startExport(req, input({ type: BRAND_KIT, agentKey: 'brand-kit' }))).logoNote).toBe('no-logo');
    });

    it('sends no logo when the kit’s logo is still a placeholder, as the print does', async () => {
      vi.stubEnv('CDN_URL_PREFIX', 'https://cdn.example.test');
      await seedKit(documentStore, { placeholder: true });

      expect((await service.startExport(req, input({ type: BRAND_KIT, agentKey: 'brand-kit' }))).logoNote).toBe('no-logo');
      expect(store.publicImages.size).toBe(0);
      expect(sentMessage()).toContain('\nLOGO URL: none\n');
    });

    it('exports the older revision a page names after a newer one is stored — by its hash or its id — and keeps the deck with it', async () => {
      const olderSha = await seedFramework(documentStore, 'Older.');
      await seedFramework(documentStore, 'Newer.', false);
      const assetsSent = (): Record<string, Record<string, unknown>> =>
        JSON.parse(sentMessage().split('--- ASSETS (JSON) ---\n')[1].split('\n--- END ASSETS ---')[0]) as Record<string, Record<string, unknown>>;

      const byHash = await service.startExport(req, input({ selector: { contentSha256: olderSha } }));
      expect(byHash.revision).toMatchObject({ number: 1, contentSha256: olderSha });
      expect(assetsSent()['framework']['mf']).toEqual({ tagline: 'Older.' });

      guildMocks.createSession.mockResolvedValueOnce('session-2');
      const byId = await service.startExport(req, input({ selector: { revisionId: byHash.revision.id } }));
      expect(byId.revision).toEqual(byHash.revision);
      expect(assetsSent()['framework']['mf']).toEqual({ tagline: 'Older.' });

      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      const result = await service.getResult(req, 'session-1', {
        project: PROJECT,
        type: FRAMEWORK,
        agentKey: 'foundation-message',
        documentId: 'living',
        revisionId: byHash.revision.id,
      });
      expect(result).toMatchObject({ status: 'ready', record: { revisionId: byHash.revision.id, revisionNumber: 1, contentSha256: olderSha } });
      // A newer Draft does not change approved current or stale the deck.
      const last = await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living');
      expect(last.latestRevision).toEqual(byHash.revision);
      expect(isMktgSlidesExportStale(last.last, last.latestRevision)).toBe(false);
    });

    it('refuses an update before any deck exists, and a revision it does not store', async () => {
      await seedFramework(documentStore);

      await expect(service.startExport(req, input({ mode: 'update' }))).rejects.toBeInstanceOf(ConflictError);
      await expect(service.startExport(req, input({ selector: { contentSha256: 'e'.repeat(64) } }))).rejects.toMatchObject({
        code: 'MKTG_APPROVED_CURRENT_CHANGED',
      });
      expect(guildMocks.createSession).not.toHaveBeenCalled();
    });
  });

  describe('getResult and getLast', () => {
    it.each([true, false])('keeps the built deck after current moves to an approved/Draft revision (approved=%s)', async (approved) => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      await seedFramework(documentStore, 'New current.', approved);
      if (!approved) {
        const draft = (await documentStore.getDocument(req, PROJECT, FRAMEWORK, 'living'))?.revisions[0];
        if (!draft) throw new Error('Missing synthetic Draft');
        await documentStore.restoreRevision(req, PROJECT, FRAMEWORK, 'living', draft.id);
      }
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      const result = await service.getResult(req, 'session-1', {
        project: PROJECT,
        type: FRAMEWORK,
        agentKey: 'foundation-message',
        documentId: 'living',
        revisionId: started.revision.id,
      });
      expect(result).toMatchObject({ status: 'ready', record: { revisionId: started.revision.id, deckId: DECK_ID } });
      const last = await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living');
      expect(last.last?.deckId).toBe(DECK_ID);
      expect(last.latestRevision === null).toBe(!approved);
      expect(isMktgSlidesExportStale(last.last, last.latestRevision)).toBe(approved);
    });
    it('keeps a ready deck with the revision it came from, once however often it is polled, and updates that deck next time', async () => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      const context = { project: PROJECT, type: FRAMEWORK, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: started.revision.id };
      guildMocks.getRawEventPayloads.mockResolvedValue([JSON.stringify({ type: 'runtime_start', content: {} }), outputEvent()]);

      const first = await service.getResult(req, 'session-1', context);
      const second = await service.getResult(req, 'session-1', context);

      expect(first).toEqual(second);
      expect(first).toMatchObject({
        status: 'ready',
        record: {
          revisionId: started.revision.id,
          revisionNumber: 1,
          deckId: DECK_ID,
          link: `https://docs.google.com/presentation/d/${DECK_ID}/edit`,
          slideCount: 12,
          mode: 'create',
          exportedAt: '2026-10-19T10:00:00.000Z',
        },
      });
      expect([...store.objects.keys()].filter((key) => key.startsWith('slides-exports/'))).toHaveLength(1);

      const last = await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living');
      expect(last.last?.deckId).toBe(DECK_ID);
      expect(last.latestRevision).toEqual(started.revision);
      expect(isMktgSlidesExportStale(last.last, last.latestRevision)).toBe(false);

      await service.startExport(req, input({ mode: 'update' }));
      expect(sentMessage()).toContain(`\nDECK ID: ${DECK_ID}\n`);
      expect(sentMessage()).toContain('\nFOLDER ID: none\n');
    });

    it('keeps the deck’s record on its own when no browser polls to the end, then stops polling', async () => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      expect((await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living')).last).toBeNull();

      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);
      expect(guildMocks.getRawEventPayloads).toHaveBeenCalledWith(req, 'session-1');
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs);

      const last = await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living');
      expect(last.last).toMatchObject({ deckId: DECK_ID, revisionId: started.revision.id });
      const polls = guildMocks.getRawEventPayloads.mock.calls.length;
      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs * 5);
      expect(guildMocks.getRawEventPayloads).toHaveBeenCalledTimes(polls);
    });

    it.each([false, true])('keeps scope in retry/deadline logs (family=%s)', async (family) => {
      await seedFramework(documentStore);
      if (family) await service.startFamilyExport(req, { project: PROJECT, projectName: 'Synthetic project', familyId: 'positioning-brand', mode: 'create' });
      else await service.startExport(req, input());
      const logContext = family ? { family: 'positioning-brand' } : { agent: 'foundation-message' };
      guildMocks.getRawEventPayloads.mockRejectedValueOnce(new Error('guild unavailable'));

      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs * 2);
      expect(guildMocks.getRawEventPayloads).toHaveBeenCalledTimes(2);
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'mktg_slides_export_finish',
        expect.any(String),
        expect.objectContaining({ session_id: 'session-1', ...logContext })
      );

      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.timeoutMs);
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'mktg_slides_export_finish',
        expect.stringContaining('deadline'),
        expect.objectContaining(logContext)
      );
      const polls = guildMocks.getRawEventPayloads.mock.calls.length;
      expect(polls).toBeLessThanOrEqual(MKTG_SLIDES_EXPORT_POLL.maxAttempts + 1);
      await vi.advanceTimersByTimeAsync(MKTG_SLIDES_EXPORT_POLL.intervalMs * 5);
      expect(guildMocks.getRawEventPayloads).toHaveBeenCalledTimes(polls);
    });

    it('reports newly approved current beside the last export', async () => {
      await seedFramework(documentStore, 'First.');
      const started = await service.startExport(req, input());
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await service.getResult(req, 'session-1', {
        project: PROJECT,
        type: FRAMEWORK,
        agentKey: 'foundation-message',
        documentId: 'living',
        revisionId: started.revision.id,
      });
      const newer = await seedFramework(documentStore, 'Second.');

      const last = await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living');

      expect(last.last?.contentSha256).toBe(started.revision.contentSha256);
      expect(last.latestRevision).toMatchObject({ number: 2, contentSha256: newer });
      expect(isMktgSlidesExportStale(last.last, last.latestRevision)).toBe(true);
    });

    it('marks a deck stale when Make current selects older approved content', async () => {
      await seedFramework(documentStore, 'Older approval.');
      const olderId = (await documentStore.readApprovedCurrentSummary(req, PROJECT, FRAMEWORK, 'living'))?.id ?? '';
      await seedFramework(documentStore, 'Exported approval.');
      const started = await service.startExport(req, input());
      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      await service.getResult(req, 'session-1', { ...input(), revisionId: started.revision.id });
      await documentStore.restoreRevision(req, PROJECT, FRAMEWORK, 'living', olderId);
      const last = await service.getLast(req, PROJECT, FRAMEWORK, 'foundation-message', 'living');
      expect(last.latestRevision).toMatchObject({ id: olderId, number: 1 });
      expect(isMktgSlidesExportStale(last.last, last.latestRevision)).toBe(true);
    });

    it('answers a failed export with a plain message and the deck it left behind, never the error text', async () => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      const context = { project: PROJECT, type: FRAMEWORK, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: started.revision.id };
      const link = `https://docs.google.com/presentation/d/${DECK_ID}/edit`;
      const settled = new Date(Date.now() - 60_000).toISOString();
      guildMocks.getRawEventPayloads.mockResolvedValue([
        JSON.stringify({
          type: 'runtime_error',
          created_at: settled,
          content: { error: 'Error', message: `export of deck ${DECK_ID} (${link}) failed after the deck was copied: update_presentation failed: 400` },
        }),
      ]);

      const result = await service.getResult(req, 'session-1', context);

      expect(result).toEqual({
        status: 'failed',
        failure: 'partial',
        message: 'Google Slides stopped partway through the export, so the deck may be incomplete. Try again.',
        deckLink: link,
      });
      expect(JSON.stringify(result)).not.toContain('update_presentation');
      expect(loggerMocks.warning).toHaveBeenCalledWith(
        req,
        'mktg_slides_export_result',
        'Slides export failed',
        expect.objectContaining({ agent: 'foundation-message' })
      );
    });

    it('waits on an error the session may still recover from: a recent one, or one followed by more work', async () => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      const context = { project: PROJECT, type: FRAMEWORK, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: started.revision.id };
      const drop = (createdAt: string): string =>
        JSON.stringify({
          type: 'runtime_error',
          created_at: createdAt,
          content: { error: 'BadGateway', message: 'MCP server ended the session unexpectedly.' },
        });
      const minuteAgo = new Date(Date.now() - 60_000);

      guildMocks.getRawEventPayloads.mockResolvedValue([drop(new Date().toISOString())]);
      expect(await service.getResult(req, 'session-1', context)).toEqual({ status: 'pending' });

      guildMocks.getRawEventPayloads.mockResolvedValue([
        drop(minuteAgo.toISOString()),
        JSON.stringify({
          type: 'agent_notification_progress',
          created_at: new Date(minuteAgo.getTime() + 20_000).toISOString(),
          content: { type: 'text', data: 'Reading another source.' },
        }),
      ]);
      expect(await service.getResult(req, 'session-1', context)).toEqual({ status: 'pending' });

      for (const type of ['llm_start', 'runtime_start', 'tool_start']) {
        guildMocks.getRawEventPayloads.mockResolvedValue([
          drop(minuteAgo.toISOString()),
          JSON.stringify({ type, created_at: new Date(minuteAgo.getTime() + 1_000).toISOString(), content: {} }),
        ]);
        expect(await service.getResult(req, 'session-1', context)).toEqual({ status: 'pending' });
      }

      // Settled, with nothing after it but the run's teardown: a failed export.
      guildMocks.getRawEventPayloads.mockResolvedValue([
        drop(minuteAgo.toISOString()),
        JSON.stringify({ type: 'runtime_done', created_at: new Date(minuteAgo.getTime() + 1_000).toISOString(), content: {} }),
      ]);
      expect(await service.getResult(req, 'session-1', context)).toMatchObject({ status: 'failed', failure: 'google' });
    });

    it('is pending without an output, ignores a tampered envelope, and fails on an output that is not one', async () => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      const context = { project: PROJECT, type: FRAMEWORK, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: started.revision.id };

      expect(await service.getResult(req, 'session-1', context)).toEqual({ status: 'pending' });

      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent({ tamper: true })]);
      expect((await service.getResult(req, 'session-1', context)).status).toBe('failed');
      expect([...store.objects.keys()].some((key) => key.startsWith('slides-exports/'))).toBe(false);

      guildMocks.getRawEventPayloads.mockResolvedValue([
        JSON.stringify({ type: 'agent_notification_message', content: { type: 'text', data: 'the input is not a Slides export intake (…)' } }),
      ]);
      expect(await service.getResult(req, 'session-1', context)).toMatchObject({ status: 'failed', failure: 'intake' });
    });

    it('takes the envelope only from the exporter’s final output, never a notice, a progress event or a tool’s event', async () => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      const context = { project: PROJECT, type: FRAMEWORK, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: started.revision.id };
      const envelopeText = (JSON.parse(outputEvent()) as { content: { data: string } }).content.data;

      guildMocks.getRawEventPayloads.mockResolvedValue([
        JSON.stringify({ type: 'agent_notification_message', content: envelopeText }),
        JSON.stringify({ type: 'agent_notification_progress', content: { type: 'text', data: envelopeText } }),
        JSON.stringify({ type: 'runtime_done', content: { output: envelopeText } }),
        JSON.stringify({ type: 'llm_start', payload: JSON.stringify({ messages: [{ role: 'assistant', content: [{ type: 'text', text: envelopeText }] }] }) }),
      ]);
      expect(await service.getResult(req, 'session-1', context)).toEqual({ status: 'pending' });
      expect([...store.objects.keys()].some((key) => key.startsWith('slides-exports/'))).toBe(false);

      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent()]);
      expect(await service.getResult(req, 'session-1', context)).toMatchObject({ status: 'ready', record: { deckId: DECK_ID } });
    });

    it('keeps a finished deck when another output follows its envelope, and takes the later of two envelopes', async () => {
      await seedFramework(documentStore);
      const started = await service.startExport(req, input());
      const context = { project: PROJECT, type: FRAMEWORK, agentKey: 'foundation-message' as const, documentId: 'living', revisionId: started.revision.id };
      const otherDeck = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa';

      guildMocks.getRawEventPayloads.mockResolvedValue([
        outputEvent(),
        JSON.stringify({ type: 'agent_notification_message', content: { type: 'text', data: 'the input is not a Slides export intake (…)' } }),
      ]);
      expect(await service.getResult(req, 'session-1', context)).toMatchObject({ status: 'ready', record: { deckId: DECK_ID } });

      guildMocks.getRawEventPayloads.mockResolvedValue([outputEvent(), outputEvent({ deckId: otherDeck })]);
      expect(await service.getResult(req, 'session-1', context)).toMatchObject({ status: 'ready', record: { deckId: otherDeck } });
    });
  });
});
