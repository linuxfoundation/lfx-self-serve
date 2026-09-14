// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE } from '@lfx-one/shared/constants';
import { MktgStoredAgentRun } from '@lfx-one/shared/interfaces';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgArtifactService } from '@services/mktg-artifact.service';
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
});
