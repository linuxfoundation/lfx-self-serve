// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgStoredAgentRun } from '@lfx-one/shared/interfaces';
import { BrandKitService } from '@services/brand-kit.service';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgDependencyService } from './mktg-dependency.service';

/**
 * Dependency resolution (dec-agent-dependency-gating) plus the staleness
 * signal that keeps the marketplace honest: a Brand Kit generated in this
 * session must unlock its dependents without a page reload, and a notification
 * must never be replayed to a subscriber that arrived afterwards — a replayed
 * one would make the grid resolve twice on first load.
 */
describe('MktgDependencyService', () => {
  const storedRun = (document: string): MktgStoredAgentRun => ({
    agentId: 'brand-kit',
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
        { provide: BrandKitService, useValue: { getStored } },
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
    it('prefers the server-persisted Brand Kit', async () => {
      getStored.mockReturnValue(of({ documentMarkdown: '# Server kit', receipt: { version: 4 } }));

      const resolved = await new Promise((resolve) => service.resolveDependencies('proj-1', ['brand-kit']).subscribe(resolve));

      expect(resolved).toEqual({ 'brand-kit': { agentId: 'brand-kit', source: 'server', version: 4, document: '# Server kit' } });
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
