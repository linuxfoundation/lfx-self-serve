// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, HttpStatusCode } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_CONTRACT_ID, BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_ANCHOR_QUESTIONS, FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants';
import { FoundationMessageContent, MktgDependencyDocument, MktgRunAsset, MktgStoredAgentRun } from '@lfx-one/shared/interfaces';
import { renderFoundationMessageMarkdown } from '@lfx-one/shared/utils';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgArtifactService } from '@services/mktg-artifact.service';
import { brandKitTestRevision } from '@shared/testing/brand-kit-test-data';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgDependencyService } from './mktg-dependency.service';

/**
 * Dependency resolution (dec-agent-dependency-gating) plus the staleness
 * signal that keeps the marketplace honest: a Brand Kit generated in this
 * session must unlock its dependents without a page reload, and a notification
 * must never be replayed to a subscriber that arrived afterwards — a replayed
 * one would make the grid resolve twice on first load.
 *
 * Resolution is generic over agents: the server source is the agent's own
 * registered `endpoints.stored`, so a Message Foundation generated in a
 * DIFFERENT browser resolves exactly like a Brand Kit does.
 */
const pair = (a: string, b: string): [string, string] => [a, b];

/** A contract-true Messaging Framework: the counts the agent gates, the message house in agreement with the framework. */
function buildFramework(): FoundationMessageContent {
  const goal = (id: string, n: number, t: string, icps: string[]): FoundationMessageContent['mf']['goals'][number] => ({
    id,
    n,
    t,
    vp: `${t} value proposition.`,
    key: `${t} key message.`,
    proof: [pair('1,200 members', 'Website'), pair('40 releases a year', 'Docs')],
    bite: `${t} in open source`,
    icps,
  });
  const icp = (id: string, name: string, goals: string[]): FoundationMessageContent['icp'][number] => ({
    id,
    name,
    kind: 'Organization',
    who: `${name}, described.`,
    goals,
    need: 'A need.',
    value: 'A value.',
    lead: `${name} lead message.`,
    proof: [pair('A fact', 'Website')],
    cta: 'Join the project.',
    channels: ['Events'],
    objection: ['Too early?', null],
    personas: [pair('CTO', 'risk')],
    basis: 'Website',
  });
  const icps = [
    icp('vendors', 'Vendors', ['adoption']),
    icp('users', 'End users', ['adoption']),
    icp('contributors', 'Contributors', ['community']),
    icp('members', 'Members', ['membership']),
  ];
  const pillar = (t: string): FoundationMessageContent['mh']['pillars'][number] => ({
    t,
    m: `${t} message.`,
    p: [pair('Fact one', 'Website'), pair('Fact two', 'Docs'), pair('Fact three', 'Web')],
  });
  return {
    mf: {
      vision: 'A vision.',
      mission: 'A mission.',
      positioning: 'For platform teams, TestOrbit is the open release toolkit.',
      tagline: 'Release, open.',
      goals: [
        goal('adoption', 1, 'Adoption', ['vendors', 'users']),
        goal('community', 2, 'Community', ['contributors']),
        goal('membership', 3, 'Membership', ['members']),
      ],
      crosscut: 'Goal 5 (grow our audience) has no column of its own: every column grows the audience when members amplify it.',
      say: ['open release', 'community-governed'],
      avoid: [pair('best-in-class', 'proven in production')],
      anchor: [...FOUNDATION_MESSAGE_ANCHOR_QUESTIONS],
      notes: '',
    },
    icp: icps,
    mh: {
      umbrella: 'Open releases for everyone.',
      line: 'Release, open.',
      pillars: [pillar('Open'), pillar('Proven'), pillar('Neutral')],
      found: 'A Linux Foundation project.',
      aud: icps.map((segment) => pair(segment.name, segment.lead)),
    },
    nums: [pair('1,200', 'members'), pair('40', 'releases a year'), pair('[00]', '[metric, from LFX]')],
  };
}

describe('MktgDependencyService', () => {
  const storedRun = (document: string, agentId = 'brand-kit'): MktgStoredAgentRun => ({
    agentId,
    projectUid: 'proj-1',
    sessionId: 'sess-1',
    ownerToken: 'token-1',
    answers: {},
    versions: [{ version: 3, document, createdAt: '2026-08-19T00:00:00.000Z' }],
    savedAt: '2026-08-19T00:00:00.000Z',
  });

  let service: MktgDependencyService;
  let getStored: ReturnType<typeof vi.fn>;
  let loadRun: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getStored = vi.fn(() => throwError(() => new Error('nothing stored')));
    loadRun = vi.fn(() => null);
    TestBed.configureTestingModule({
      providers: [
        { provide: MktgArtifactService, useValue: { getStored } },
        { provide: MktgAgentRunService, useValue: { loadRun } },
      ],
    });
    service = TestBed.inject(MktgDependencyService);
  });

  describe('documentsChanged$ — the marketplace’s staleness signal', () => {
    it('emits the project uid whose documents changed', () => {
      const seen: string[] = [];
      service.documentsChanged$.subscribe((uid) => seen.push(uid));

      service.notifyDocumentsChanged('proj-1');
      service.notifyDocumentsChanged('proj-2');

      expect(seen).toEqual(['proj-1', 'proj-2']);
    });

    it('does NOT replay to a later subscriber — a replay would double-resolve the grid on first load', () => {
      service.notifyDocumentsChanged('proj-1');

      const seen: string[] = [];
      service.documentsChanged$.subscribe((uid) => seen.push(uid));

      expect(seen).toEqual([]);
    });

    it('ignores an empty project uid rather than emitting an unusable notification', () => {
      const seen: string[] = [];
      service.documentsChanged$.subscribe((uid) => seen.push(uid));

      service.notifyDocumentsChanged('');

      expect(seen).toEqual([]);
    });
  });

  describe('resolveDependencies', () => {
    it('prefers the server-persisted Brand Kit over this browser’s stored run', async () => {
      // BOTH sources have a document and they disagree. The server copy is
      // the project's; the browser copy is one session's TTL-bounded run —
      // so the server one must win even when the browser one exists.
      getStored.mockReturnValue(of({ documentMarkdown: '# Server kit', receipt: { version: 4 } }));
      loadRun.mockReturnValue(storedRun('# Browser kit'));

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', ['brand-kit']).subscribe(resolve));

      expect(resolved).toEqual({ 'brand-kit': { agentId: 'brand-kit', source: 'server', version: 4, document: '# Server kit' } });
      expect(getStored).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.stored, 'proj-1');
    });

    it('resolves a mixed batch in one record, each agent from its OWN stored endpoint', async () => {
      // The production callers (marketplace gating, intake auto-attachments)
      // pass every dependency at once; this is the forkJoin aggregation path.
      const byEndpoint: Record<string, { documentMarkdown: string; receipt: { version: number } }> = {
        [BRAND_KIT_INTAKE.endpoints.stored as string]: { documentMarkdown: '# Server kit', receipt: { version: 4 } },
        [FOUNDATION_MESSAGE_INTAKE.endpoints.stored as string]: { documentMarkdown: '# Server message foundation', receipt: { version: 2 } },
      };
      getStored.mockImplementation((endpoint: string) => of(byEndpoint[endpoint]));

      const resolved = await new Promise((resolve) =>
        service.resolveDependencies('proj-1', ['brand-kit', FOUNDATION_MESSAGE_INTAKE.agentId, 'brand-kit']).subscribe(resolve)
      );

      expect(resolved).toEqual({
        'brand-kit': { agentId: 'brand-kit', source: 'server', version: 4, document: '# Server kit' },
        [FOUNDATION_MESSAGE_INTAKE.agentId]: {
          agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
          source: 'server',
          version: 2,
          document: '# Server message foundation',
        },
      });
      // Duplicate ids are collapsed — one request per distinct agent.
      expect(getStored).toHaveBeenCalledTimes(2);
      expect(getStored).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.stored, 'proj-1');
      expect(getStored).toHaveBeenCalledWith(FOUNDATION_MESSAGE_INTAKE.endpoints.stored, 'proj-1');
    });

    it('a mixed batch degrades PER AGENT — one server miss does not fail or blank the others', async () => {
      getStored.mockImplementation((endpoint: string) =>
        endpoint === BRAND_KIT_INTAKE.endpoints.stored
          ? of({ documentMarkdown: '# Server kit', receipt: { version: 4 } })
          : throwError(() => new Error('nothing stored'))
      );

      const resolved = await new Promise((resolve) =>
        service.resolveDependencies('proj-1', ['brand-kit', FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve)
      );

      expect(resolved).toEqual({
        'brand-kit': { agentId: 'brand-kit', source: 'server', version: 4, document: '# Server kit' },
        [FOUNDATION_MESSAGE_INTAKE.agentId]: null,
      });
    });

    it('a mixed batch falls back PER AGENT — the server-missing agent takes its browser run while the other keeps the server copy', async () => {
      // The production path in one shot: `catchError → browserFallback$` is
      // applied per forkJoin branch, so one agent's server miss lands on ITS
      // browser run without disturbing the sibling that resolved from the server.
      getStored.mockImplementation((endpoint: string) =>
        endpoint === BRAND_KIT_INTAKE.endpoints.stored
          ? of({ documentMarkdown: '# Server kit', receipt: { version: 4 } })
          : throwError(() => new Error('nothing stored'))
      );
      loadRun.mockImplementation((_projectUid: string, agentId: string) =>
        agentId === FOUNDATION_MESSAGE_INTAKE.agentId ? storedRun('# Browser message foundation', agentId) : null
      );

      const resolved = await new Promise((resolve) =>
        service.resolveDependencies('proj-1', ['brand-kit', FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve)
      );

      expect(resolved).toEqual({
        'brand-kit': { agentId: 'brand-kit', source: 'server', version: 4, document: '# Server kit' },
        [FOUNDATION_MESSAGE_INTAKE.agentId]: {
          agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
          source: 'browser',
          version: 3,
          document: '# Browser message foundation',
        },
      });
    });

    it('resolves a Message Foundation generated in a DIFFERENT browser from the server copy', async () => {
      // Nothing in THIS browser's storage — the only copy is the project's
      // server-persisted one, which is precisely what dependent agents (and
      // every other user of the project) could not reach before.
      getStored.mockReturnValue(of({ documentMarkdown: '# Server message foundation', receipt: { version: 2 } }));

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve));

      expect(getStored).toHaveBeenCalledWith(FOUNDATION_MESSAGE_INTAKE.endpoints.stored, 'proj-1');
      expect(resolved).toEqual({
        [FOUNDATION_MESSAGE_INTAKE.agentId]: {
          agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
          source: 'server',
          version: 2,
          document: '# Server message foundation',
        },
      });
    });

    describe('with sidecar — the Brand Kit’s messaging framework, the latest revision whatever its review status', () => {
      const sidecarIds = [FOUNDATION_MESSAGE_INTAKE.agentId];

      it('reads the server’s latest revision, with its date and its sidecar JSON', async () => {
        getStored.mockReturnValue(
          of({
            documentMarkdown: '# Latest messaging framework',
            receipt: { version: 2 },
            storedAt: '2026-10-16T09:00:00.000Z',
            sidecar: { fields: { 'md.tagline': { value: 'Open standards', source: 'Site', status: 'draft' } } },
          })
        );

        const resolved = await new Promise((resolve) =>
          service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId], sidecarIds).subscribe(resolve)
        );

        expect(getStored).toHaveBeenCalledWith(FOUNDATION_MESSAGE_INTAKE.endpoints.stored, 'proj-1', true);
        expect(resolved).toEqual({
          [FOUNDATION_MESSAGE_INTAKE.agentId]: {
            agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
            source: 'server',
            version: 2,
            document: '# Latest messaging framework',
            storedAt: '2026-10-16T09:00:00.000Z',
            sidecar: { fields: { 'md.tagline': { value: 'Open standards', source: 'Site', status: 'draft' } } },
          },
        });
      });

      it('keeps a JSON framework revision’s sidecar — the stored record the Brand Kit submits — as is, and gives its document as Markdown', async () => {
        const content = buildFramework();
        const sidecar = { contract: 'messaging-framework-output/v1', content, report: { sources_read: [], sources_failed: [], gaps: [], notes: '' } };
        getStored.mockReturnValue(of({ documentMarkdown: JSON.stringify(content), format: 'json', receipt: { version: 3 }, sidecar }));

        const resolved = await new Promise<Record<string, MktgDependencyDocument | null>>((resolve) =>
          service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId], sidecarIds).subscribe(resolve)
        );

        expect(resolved[FOUNDATION_MESSAGE_INTAKE.agentId]?.sidecar).toEqual(sidecar);
        expect(resolved[FOUNDATION_MESSAGE_INTAKE.agentId]?.document).toBe(renderFoundationMessageMarkdown(content));
      });

      it('names the revision by its number in Documents, not the agent’s draft version — a third fresh run is v3, though its draft is 1', async () => {
        getStored.mockReturnValue(of({ documentMarkdown: '# Latest messaging framework', receipt: { version: 1 }, revisionNumber: 3, sidecar: {} }));

        const resolved = await new Promise<Record<string, MktgDependencyDocument | null>>((resolve) =>
          service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId], sidecarIds).subscribe(resolve)
        );

        expect(resolved[FOUNDATION_MESSAGE_INTAKE.agentId]?.version).toBe(3);
      });

      it('resolves to null on a 404 — no revision at all — and never falls back to this browser’s stored run, which carries no sidecar', async () => {
        getStored.mockReturnValue(throwError(() => new HttpErrorResponse({ status: HttpStatusCode.NotFound, statusText: 'Not Found' })));
        loadRun.mockReturnValue(storedRun('# Browser message foundation', FOUNDATION_MESSAGE_INTAKE.agentId));

        const resolved = await new Promise((resolve) =>
          service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId], sidecarIds).subscribe(resolve)
        );

        expect(resolved).toEqual({ [FOUNDATION_MESSAGE_INTAKE.agentId]: null });
        expect(loadRun).not.toHaveBeenCalled();
      });

      it.each([
        ['a 403', new HttpErrorResponse({ status: HttpStatusCode.Forbidden, statusText: 'Forbidden' })],
        ['a 500', new HttpErrorResponse({ status: HttpStatusCode.InternalServerError, statusText: 'Server Error' })],
        ['a network failure', new Error('network down')],
      ])('logs and rethrows %s instead of reporting it as "no revision"', async (_label, failure) => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        getStored.mockReturnValue(throwError(() => failure));

        const outcome = await new Promise<{ error?: unknown; value?: unknown }>((resolve) =>
          service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId], sidecarIds).subscribe({
            next: (value) => resolve({ value }),
            error: (error: unknown) => resolve({ error }),
          })
        );

        expect(outcome).toEqual({ error: failure });
        expect(consoleError).toHaveBeenCalledWith(
          '[mktg-dependency] latest revision read failed',
          expect.objectContaining({ agentId: FOUNDATION_MESSAGE_INTAKE.agentId, projectUid: 'proj-1', error: failure })
        );
        expect(loadRun).not.toHaveBeenCalled();
        consoleError.mockRestore();
      });

      it('leaves the other ids of the same batch on the plain latest read', async () => {
        getStored.mockImplementation((endpoint: string, _projectUid: string, withSidecar?: boolean) =>
          of({ documentMarkdown: `# ${endpoint} ${withSidecar ? 'with sidecar' : 'markdown only'}`, receipt: { version: 1 } })
        );

        const resolved = await new Promise<Record<string, MktgDependencyDocument | null>>((resolve) =>
          service.resolveDependencies('proj-1', ['brand-kit', FOUNDATION_MESSAGE_INTAKE.agentId], sidecarIds).subscribe(resolve)
        );

        expect(getStored).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.stored, 'proj-1');
        expect(resolved['brand-kit']?.document).toContain('markdown only');
        expect(resolved[FOUNDATION_MESSAGE_INTAKE.agentId]?.document).toContain('with sidecar');
      });
    });

    it('falls back to this browser’s stored Message Foundation when the server has none', async () => {
      loadRun.mockReturnValue(storedRun('# Browser message foundation', FOUNDATION_MESSAGE_INTAKE.agentId));

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve));

      expect(resolved).toEqual({
        [FOUNDATION_MESSAGE_INTAKE.agentId]: {
          agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
          source: 'browser',
          version: 3,
          document: '# Browser message foundation',
        },
      });
    });

    it('hands over the server’s stored Messaging Framework (a JSON revision) as Markdown, never as JSON text', async () => {
      // The ICP takes it as `message_foundation_markdown`, a Markdown document by its contract.
      const content = buildFramework();
      getStored.mockReturnValue(of({ documentMarkdown: JSON.stringify(content), format: 'json', receipt: { version: 2 } }));
      loadRun.mockReturnValue(storedRun('# Browser message foundation', FOUNDATION_MESSAGE_INTAKE.agentId));

      const resolved = await new Promise<Record<string, unknown>>((resolve) =>
        service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve)
      );

      expect(resolved).toEqual({
        [FOUNDATION_MESSAGE_INTAKE.agentId]: {
          agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
          source: 'server',
          version: 2,
          document: renderFoundationMessageMarkdown(content),
        },
      });
      expect(JSON.stringify(resolved)).toContain('# Messaging framework');
    });

    it('falls back to this browser’s run when the server’s stored JSON is not a framework, rather than attaching JSON text', async () => {
      getStored.mockReturnValue(of({ documentMarkdown: JSON.stringify({ mf: {} }), format: 'json', receipt: { version: 2 } }));
      loadRun.mockReturnValue(storedRun('# Browser message foundation', FOUNDATION_MESSAGE_INTAKE.agentId));

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve));

      expect(resolved).toEqual({
        [FOUNDATION_MESSAGE_INTAKE.agentId]: {
          agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
          source: 'browser',
          version: 3,
          document: '# Browser message foundation',
        },
      });
    });

    it('falls back to this browser’s stored Messaging Framework asset rendered to Markdown, the same reading the server copy gets', async () => {
      const content = buildFramework();
      const asset = { kind: 'messaging-framework', mode: 'draft', content, report: {}, checks: { findings: [] } } as unknown as MktgRunAsset;
      const run = storedRun('', FOUNDATION_MESSAGE_INTAKE.agentId);
      loadRun.mockReturnValue({ ...run, versions: [{ ...run.versions[0], asset }] });

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve));

      expect(resolved).toEqual({
        [FOUNDATION_MESSAGE_INTAKE.agentId]: {
          agentId: FOUNDATION_MESSAGE_INTAKE.agentId,
          source: 'browser',
          version: 3,
          document: renderFoundationMessageMarkdown(content),
        },
      });
    });

    it('resolves nothing from a browser-stored asset that is not a framework (stale or hand-edited storage)', async () => {
      const content = { mf: { tagline: 'Release, open.' } } as unknown as MktgRunAsset['content'];
      const asset = { kind: 'messaging-framework', mode: 'draft', content, report: {}, checks: { findings: [] } } as unknown as MktgRunAsset;
      const run = storedRun('', FOUNDATION_MESSAGE_INTAKE.agentId);
      loadRun.mockReturnValue({ ...run, versions: [{ ...run.versions[0], asset }] });

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', [FOUNDATION_MESSAGE_INTAKE.agentId]).subscribe(resolve));

      expect(resolved).toEqual({ [FOUNDATION_MESSAGE_INTAKE.agentId]: null });
    });

    it('never asks the server for an agent that persists nothing', async () => {
      loadRun.mockReturnValue(storedRun('# Browser only', 'pitch-deck'));

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', ['pitch-deck']).subscribe(resolve));

      expect(getStored).not.toHaveBeenCalled();
      expect(resolved).toEqual({ 'pitch-deck': { agentId: 'pitch-deck', source: 'browser', version: 3, document: '# Browser only' } });
    });

    it('falls back to this browser’s stored run when the server has none', async () => {
      loadRun.mockReturnValue(storedRun('# Browser kit'));

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', ['brand-kit']).subscribe(resolve));

      expect(resolved).toEqual({ 'brand-kit': { agentId: 'brand-kit', source: 'browser', version: 3, document: '# Browser kit' } });
    });

    it('resolves an unresolvable dependency to null rather than failing the whole record', async () => {
      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', ['brand-kit']).subscribe(resolve));

      expect(resolved).toEqual({ 'brand-kit': null });
    });

    it('resolves an empty dependency list immediately', async () => {
      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', []).subscribe(resolve));

      expect(resolved).toEqual({});
      expect(getStored).not.toHaveBeenCalled();
    });
  });
  describe('resolveBrandKit — the brand another asset’s print is set in', () => {
    const kit = brandKitTestRevision();
    const sidecar = {
      contract: BRAND_KIT_CONTRACT_ID,
      project_name: kit.projectName,
      project: kit.project,
      version: kit.version,
      mode: kit.mode,
      kit: kit.kit,
      chapters: kit.chapters,
      report: kit.report,
      inputs: { website_url: kit.websiteUrl },
      generated_at: kit.generatedAt,
      agent: { agent_version: kit.agentVersion },
    };

    it('reads the project’s latest Brand Kit revision from its sidecar', async () => {
      getStored.mockReturnValue(of({ documentMarkdown: '# Kit', receipt: { version: 1 }, revisionNumber: 2, sidecar }));

      const resolved = await new Promise((resolve) => service.resolveBrandKit('proj-1').subscribe(resolve));

      expect(getStored).toHaveBeenCalledWith(BRAND_KIT_INTAKE.endpoints.stored, 'proj-1', true);
      expect(resolved).toEqual(expect.objectContaining({ projectName: kit.projectName, kit: kit.kit }));
    });

    it('is null — the LF look — when the project has no kit, when the read fails, and for a kit stored as Markdown alone', async () => {
      getStored.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: HttpStatusCode.NotFound })));
      expect(await new Promise((resolve) => service.resolveBrandKit('proj-1').subscribe(resolve))).toBeNull();

      getStored.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: HttpStatusCode.Forbidden })));
      expect(await new Promise((resolve) => service.resolveBrandKit('proj-1').subscribe(resolve))).toBeNull();

      getStored.mockReturnValueOnce(of({ documentMarkdown: '# Kit', receipt: { version: 1 } }));
      expect(await new Promise((resolve) => service.resolveBrandKit('proj-1').subscribe(resolve))).toBeNull();
    });

    it('asks nothing without a project', async () => {
      expect(await new Promise((resolve) => service.resolveBrandKit('').subscribe(resolve))).toBeNull();
      expect(getStored).not.toHaveBeenCalled();
    });
  });
});
