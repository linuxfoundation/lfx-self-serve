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

vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-artifact.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document-store.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-document.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-envelope.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/brand-kit.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/mktg-slides-export.utils')),
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
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/brand-kit.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-slides-export.constants')),
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
    public async listObjects(_req: unknown, _purpose: string, prefix: string): Promise<{ key: string; lastModified?: Date }[]> {
      return [...store.objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, object]) => ({ key, lastModified: object.lastModified }));
    }
    public async getObject(_req: unknown, _purpose: string, key: string): Promise<{ body: string; metadata: Record<string, string> } | null> {
      const object = store.objects.get(key);
      return object ? { body: object.body, metadata: object.metadata } : null;
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

import { MKTG_ARTIFACT_SPECS, MKTG_DOCUMENT_TYPES, MKTG_SLIDES_EXPORT_FOLDER_ID } from '@lfx-one/shared/constants';
import type { MktgDocumentType, MktgSlidesExportStartInput } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { brandKitTestRevision } from '../../app/shared/testing/brand-kit-test-data';
import { ConflictError, ResourceNotFoundError } from '../errors';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { MktgSlidesExportService } from './mktg-slides-export.service';

const req = { path: '/api/mktg-agents/slides-export/start' } as unknown as Request;
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
async function seedKit(documentStore: MktgDocumentStoreService, options: { svg?: string | null } = {}): Promise<void> {
  const kit = brandKitTestRevision();
  if (options.svg !== undefined) {
    kit.chapters.logo.files.primary = options.svg === null ? null : { ref: 'logo.svg', svg: options.svg };
  }
  const markdown = `# ${kit.projectName} Brand Kit\n`;
  await documentStore.persistGeneration(
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
}

/** Store a Messaging Framework revision; returns its content hash. */
async function seedFramework(documentStore: MktgDocumentStoreService, tagline = 'Search, open.'): Promise<string> {
  const content = { mf: { tagline }, icp: [], mh: { umbrella: 'Open search.', pillars: [] }, nums: [] };
  const contentSha = sha(JSON.stringify(content));
  await documentStore.persistJsonGeneration(
    req,
    MKTG_ARTIFACT_SPECS['foundation-message'],
    { contract: 'messaging-framework-output/v1', content, content_sha256: contentSha, version: 1, mode: 'draft', intake: { mode: 'form' } } as never,
    PROJECT,
    `framework-session-${tagline}`
  );
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
      folder_id: MKTG_SLIDES_EXPORT_FOLDER_ID,
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
    guildMocks.createSession.mockResolvedValue('session-1');
    guildMocks.getRawEventPayloads.mockResolvedValue([]);
    service = new MktgSlidesExportService();
    documentStore = new MktgDocumentStoreService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      expect(lines[3]).toBe(`FOLDER ID: ${MKTG_SLIDES_EXPORT_FOLDER_ID}`);
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

    it('sends no logo, and says why, when the SVG reaches outside itself, cannot be drawn, or cannot be published', async () => {
      vi.stubEnv('CDN_URL_PREFIX', 'https://cdn.example.test');
      const kitInput = input({ type: BRAND_KIT, agentKey: 'brand-kit' });

      await seedKit(documentStore, {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 3"><image href="/etc/logo.png" width="10" height="3"/></svg>',
      });
      expect((await service.startExport(req, kitInput)).logoNote).toBe('not-drawn');
      await seedKit(documentStore, { svg: 'not an svg' });
      expect((await service.startExport(req, kitInput)).logoNote).toBe('not-drawn');
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

    it('refuses an update before any deck exists, and a revision it does not store', async () => {
      await seedFramework(documentStore);

      await expect(service.startExport(req, input({ mode: 'update' }))).rejects.toBeInstanceOf(ConflictError);
      await expect(service.startExport(req, input({ selector: { contentSha256: 'e'.repeat(64) } }))).rejects.toBeInstanceOf(ResourceNotFoundError);
      expect(guildMocks.createSession).not.toHaveBeenCalled();
    });
  });

  describe('getResult and getLast', () => {
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

      await service.startExport(req, input({ mode: 'update' }));
      expect(sentMessage()).toContain(`\nDECK ID: ${DECK_ID}\n`);
      expect(sentMessage()).toContain('\nFOLDER ID: none\n');
    });

    it('reports the newer revision beside the last export once the framework changes', async () => {
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
        JSON.stringify({ type: 'agent_notification_progress', created_at: new Date(minuteAgo.getTime() + 20_000).toISOString(), content: {} }),
      ]);
      expect(await service.getResult(req, 'session-1', context)).toEqual({ status: 'pending' });

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
  });
});
