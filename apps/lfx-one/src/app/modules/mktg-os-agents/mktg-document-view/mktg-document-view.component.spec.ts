// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { computed, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BRAND_KIT_INTAKE, MKTG_DOCUMENT_TYPES, MKTG_README_SKIP_NOTES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgAgentRunService } from '@services/mktg-agent-run.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { UserService } from '@services/user.service';
import { MktgGenerateProgress, MktgStoredAgentRun, User } from '@lfx-one/shared/interfaces';
import { MktgDocumentDetailResponse, MktgDocumentType, MktgRevisionResponse, MktgRevisionSummary, ProjectContext } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MktgDocumentViewComponent } from './mktg-document-view.component';

describe('MktgDocumentViewComponent', () => {
  const PROJECT: ProjectContext = { uid: 'proj-1', name: 'TestOrbit', slug: 'testorbit' };
  const BRAND_KIT = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'brand-kit') as MktgDocumentType;

  function revision(number: number, overrides: Partial<MktgRevisionSummary> = {}): MktgRevisionSummary {
    return {
      id: `00000${number}-${String(number).repeat(64)}`,
      number,
      createdAt: '2026-10-13T12:02:00.000Z',
      origin: 'generated',
      restoredFromNumber: null,
      intakeMode: 'form',
      status: 'Draft — for review',
      contentSha256: String(number).repeat(64),
      commentCount: 0,
      latest: false,
      ...overrides,
    };
  }

  const LATEST = revision(2, { latest: true });
  const OLDER = revision(1, { origin: 'legacy' });
  const RESTORED = revision(3, { latest: true, origin: 'restored', restoredFromNumber: 1 });
  const detail: MktgDocumentDetailResponse = { project: PROJECT.uid, type: BRAND_KIT, documentId: 'living', revisions: [LATEST, OLDER] };

  function revisionResponse(current: MktgRevisionSummary): MktgRevisionResponse {
    return { ...detail, revision: current, markdown: `# Revision ${current.number}\n` };
  }

  let harness: RouterTestingHarness;
  let generation: Subject<MktgGenerateProgress>;
  let runService: {
    takePreparedGeneration: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
    resumeGeneration: ReturnType<typeof vi.fn>;
    retryGeneration: ReturnType<typeof vi.fn>;
    loadRun: ReturnType<typeof vi.fn>;
  };
  let activeContext = signal<ProjectContext | null>(PROJECT);
  let store: {
    getDocument: ReturnType<typeof vi.fn>;
    getRevision: ReturnType<typeof vi.fn>;
    restoreRevision: ReturnType<typeof vi.fn>;
    retryRun: ReturnType<typeof vi.fn>;
  };

  function query(testId: string): HTMLElement | null {
    return harness.routeNativeElement?.querySelector(`[data-testid="${testId}"]`) ?? null;
  }

  async function render(url: string): Promise<void> {
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, MktgDocumentViewComponent);
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  async function settle(): Promise<void> {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  beforeEach(async () => {
    store = {
      getDocument: vi.fn(() => of(detail)),
      getRevision: vi.fn((_project: string, _agentKey: string, _documentId: string, revisionId: string) =>
        of(revisionResponse([LATEST, OLDER, RESTORED].find((candidate) => candidate.id === revisionId) ?? LATEST))
      ),
      restoreRevision: vi.fn(() => of({ ...detail, revision: RESTORED })),
      retryRun: vi.fn(() => of({ ...detail, runs: [] })),
    };
    activeContext = signal<ProjectContext | null>(PROJECT);
    generation = new Subject<MktgGenerateProgress>();
    runService = {
      takePreparedGeneration: vi.fn(() => null),
      generate: vi.fn(() => generation),
      resumeGeneration: vi.fn(() => null),
      retryGeneration: vi.fn(() => null),
      loadRun: vi.fn(() => null),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'documents/:agentKey/:documentId', component: MktgDocumentViewComponent }]),
        provideNoopAnimations(),
        { provide: ProjectContextService, useValue: { activeContext, activeContextUid: computed(() => activeContext()?.uid ?? '') } },
        { provide: MktgDocumentStoreService, useValue: store },
        { provide: MktgAgentRunService, useValue: runService },
        { provide: MktgDependencyService, useValue: { notifyDocumentsChanged: vi.fn() } },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-user' }) } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    harness?.fixture.destroy();
    vi.useRealTimers();
  });

  it.each(['detail', 'revision'])('retains the loaded revision and progress after a transient timer %s failure', async (part) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const run = {
      project: PROJECT.uid,
      runId: 'b'.repeat(64),
      agentKey: 'brand-kit' as const,
      documentId: 'living',
      startedAt: '2026-10-19T00:00:00Z',
      state: 'writing' as const,
    };
    const pending = { ...detail, runs: [run] };
    const complete = { ...detail, revisions: [RESTORED, LATEST], runs: [] };
    store.getDocument.mockReturnValueOnce(of(pending));
    store.getRevision.mockReturnValueOnce(of({ ...revisionResponse(LATEST), runs: [run] }));
    if (part === 'detail') {
      store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    } else {
      store.getDocument.mockReturnValueOnce(of(pending));
      store.getRevision.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    }
    store.getDocument.mockReturnValue(of(complete));
    store.getRevision.mockReturnValue(of({ ...revisionResponse(RESTORED), revisions: [RESTORED, LATEST], runs: [] }));
    await render('/documents/brand-kit/living');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(query('mktg-document-view-document')?.textContent).toContain('Revision 2');
    expect(query('mktg-document-view-generating')).not.toBeNull();
    expect(query('mktg-document-view-refresh-warning')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(query('mktg-document-view-document')?.textContent).toContain('Revision 3');
    expect(query('mktg-document-view-refresh-warning')).toBeNull();
    expect(query('mktg-document-view-generating')).toBeNull();
  });

  it.each([401, 403])('clears the loaded revision and progress when a timer loses access: %s', async (status) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const run = {
      project: PROJECT.uid,
      runId: 'b'.repeat(64),
      agentKey: 'brand-kit' as const,
      documentId: 'living',
      startedAt: '2026-10-19T00:00:00Z',
      state: 'writing' as const,
    };
    store.getDocument.mockReturnValueOnce(of({ ...detail, runs: [run] })).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status })));
    await render('/documents/brand-kit/living');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-error')).not.toBeNull();
  });

  it.each(['project', 'subject'])('retains skipped progress without extra timers, but clears it on a %s change', async (scope) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const run = {
      project: PROJECT.uid,
      runId: 'a'.repeat(64),
      agentKey: 'brand-kit' as const,
      documentId: 'living',
      startedAt: '2026-10-17T00:00:00Z',
      state: 'writing' as const,
    };
    store.getDocument
      .mockReturnValueOnce(of({ ...detail, revisions: [], runs: [run] }))
      .mockReturnValueOnce(of({ ...detail, revisions: [], runs: [], skippedRunIds: [run.runId] }));
    await render('/documents/brand-kit/living');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await settle();
    expect(query('mktg-document-view-generating')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 4);
    expect(store.getDocument).toHaveBeenCalledTimes(2);
    store.getDocument.mockReturnValue(NEVER);
    if (scope === 'project') {
      activeContext.set({ uid: 'synthetic-other', name: 'Synthetic Other', slug: 'synthetic-other' });
    } else {
      (TestBed.inject(UserService).user as WritableSignal<User | null>).set({ sub: 'synthetic-other' } as User);
    }
    await settle();
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-document')).toBeNull();
  });

  it.each([false, true])('keeps the design-aligned responsive columns with generating=%s', async (generating) => {
    if (generating) {
      runService.resumeGeneration.mockReturnValue(generation);
    }
    await render('/documents/brand-kit/living');
    const layout = query('mktg-document-view-layout');
    expect(layout?.classList.contains('flex-col')).toBe(true);
    expect(layout?.classList.contains('sm:flex-row')).toBe(true);
    expect(layout?.classList.contains('sm:items-start')).toBe(true);
    expect(layout?.classList.contains('flex-wrap')).toBe(false);
    expect(query('mktg-document-view-main')?.classList.contains('sm:flex-[999_1_560px]')).toBe(true);
    expect(query('mktg-document-view-sidebar')?.classList.contains('sm:flex-[0_1_320px]')).toBe(true);
    expect(query('mktg-document-view-sidebar')?.classList.contains('sm:min-w-[260px]')).toBe(true);
    expect(query('mktg-document-view-sidebar')?.contains(query('mktg-document-view-revisions'))).toBe(true);
    expect(query('mktg-document-view-sidebar')?.contains(query('mktg-document-view-about'))).toBe(true);
  });

  it('keeps one polite live region mounted before, during and after generation', async () => {
    await render('/documents/brand-kit/living');
    const node = query('mktg-document-view-status');
    expect(node?.getAttribute('aria-live')).toBe('polite');
    const component = harness.routeDebugElement?.componentInstance as MktgDocumentViewComponent;
    for (const [active, phase, text] of [
      [true, 'submitted', 'Writing the document'],
      [true, 'document', 'Storing the revision'],
      [false, null, ''],
    ] as const) {
      component['generating'].set(active);
      component['generationProgress'].set(phase);
      await settle();
      expect(query('mktg-document-view-status')).toBe(node);
      expect(node?.textContent?.trim()).toBe(text);
    }
  });

  it('shows server-visible first-run progress in a fresh browser without a local session capability', async () => {
    const run = {
      project: PROJECT.uid,
      runId: 'a'.repeat(64),
      agentKey: 'brand-kit',
      documentId: 'living',
      startedAt: '2026-10-15T12:00:00Z',
      state: 'writing',
    };
    store.getDocument.mockReturnValueOnce(of({ ...detail, revisions: [], runs: [run] }));
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-generating-title')?.textContent).toContain('Writing the TestOrbit Brand Kit');
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-document-view-generating-note')?.textContent).toContain('On a first run');
    expect(runService.generate).not.toHaveBeenCalled();
    expect(runService.retryGeneration).not.toHaveBeenCalled();
    harness.fixture.destroy();
  });

  it('uses server state instead of subscribing to a stale local pending capability', async () => {
    runService.loadRun.mockReturnValue({ pendingAttempt: {} });
    runService.resumeGeneration.mockReturnValue(generation);
    store.getDocument.mockReturnValue(of({ ...detail, runs: [] }));
    await render('/documents/brand-kit/living');
    expect(generation.observed).toBe(false);
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-document')).not.toBeNull();
  });

  it('routes the first retry after a local fast-path failure to its recorded server run', async () => {
    runService.takePreparedGeneration.mockReturnValueOnce({ projectUid: PROJECT.uid, agentId: 'brand-kit', intake: BRAND_KIT_INTAKE, answers: {} });
    store.getDocument.mockReturnValue(of({ ...detail, runs: [] }));
    await render('/documents/brand-kit/living?generation=1');
    runService.loadRun.mockReturnValue({ failedAttempt: {} });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    generation.error(new Error('Synthetic owner poll failure'));
    await settle();
    errorLog.mockRestore();
    const staleLocalRetry = new Subject<MktgGenerateProgress>();
    runService.retryGeneration.mockReturnValue(staleLocalRetry);
    const run = {
      project: PROJECT.uid,
      runId: 'a'.repeat(64),
      agentKey: 'brand-kit',
      documentId: 'living',
      startedAt: '2026-10-15T12:00:00Z',
      state: 'failed',
    };
    store.getDocument.mockReturnValue(of({ ...detail, runs: [run] }));
    query('mktg-document-view-retry')?.click();
    await settle();
    expect(store.retryRun).toHaveBeenCalledWith(PROJECT.uid, 'brand-kit', 'living', run.runId);
    expect(staleLocalRetry.observed).toBe(false);
    expect(runService.generate).toHaveBeenCalledTimes(1);
  });

  it('shows the completed session reply as plain text, with retry and no generating card or invented revision', async () => {
    const failureText = 'The batch intake was rejected. <b>Provide project sources.</b>';
    store.getDocument.mockReturnValueOnce(
      of({
        ...detail,
        runs: [
          {
            project: PROJECT.uid,
            runId: 'a'.repeat(64),
            agentKey: 'brand-kit',
            documentId: 'living',
            startedAt: '2026-10-15T12:00:00Z',
            state: 'failed',
            failureText,
          },
        ],
      })
    );
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-error')?.textContent).toContain(failureText);
    expect(query('mktg-document-view-error')?.querySelector('b')).toBeNull();
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-document')?.textContent).toContain('Revision 2');
    expect(query('mktg-document-view-retry-note')?.textContent).toContain('no new generation is started');
    expect(runService.generate).not.toHaveBeenCalled();
  });

  it('retries a failed server run without using a browser owner token or starting generation', async () => {
    const run = {
      project: PROJECT.uid,
      runId: 'a'.repeat(64),
      agentKey: 'brand-kit',
      documentId: 'living',
      startedAt: '2026-10-15T12:00:00Z',
      state: 'failed',
    };
    store.getDocument.mockReturnValueOnce(of({ ...detail, runs: [run] }));
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-retry-note')?.textContent).toContain('no new generation is started');
    query('mktg-document-view-retry')?.click();
    await settle();
    expect(store.retryRun).toHaveBeenCalledWith(PROJECT.uid, 'brand-kit', 'living', run.runId);
    expect(runService.generate).not.toHaveBeenCalled();
    expect(runService.retryGeneration).not.toHaveBeenCalled();
  });

  it('uses the design card text, stored local start time and only known writing/storing phases on resume', async () => {
    const startedAt = '2026-10-15T08:40:00.000Z';
    const run: MktgStoredAgentRun = {
      agentId: 'brand-kit',
      projectUid: PROJECT.uid,
      sessionId: 'synthetic-session',
      ownerToken: 'synthetic-token',
      answers: {},
      versions: [{ version: 1, document: '# Next document', createdAt: startedAt }],
      savedAt: startedAt,
      pendingAttempt: { session: { agentId: 'brand-kit', sessionId: 'synthetic-session', ownerToken: 'synthetic-token' }, priorVersion: 0, startedAt },
    };
    runService.loadRun.mockReturnValue(run);
    runService.resumeGeneration.mockReturnValue(generation);
    await render('/documents/brand-kit/living');
    generation.next({ type: 'submitted' });
    await settle();
    expect(query('mktg-document-view-generating-title')?.textContent).toBe('Writing the TestOrbit Brand Kit');
    expect(query('mktg-document-view-generating-meta')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      `Started ${new DatePipe('en-US').transform(startedAt, 'd MMM, HH:mm')} · usually three to five minutes · you can leave this page; the result lands in Documents`
    );
    expect(query('mktg-document-view-writing-step')?.textContent).toContain('●');
    expect(query('mktg-document-view-writing-step')?.getAttribute('aria-current')).toBe('step');
    expect(query('mktg-document-view-writing-step')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('●');
    expect(query('mktg-document-view-generating-note')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Below this card, revision 2 stays readable until revision 3 lands.'
    );
    generation.next({ type: 'activity', activity: [] });
    await settle();
    expect(query('mktg-document-view-writing-step')?.getAttribute('aria-current')).toBe('step');
    expect(query('mktg-document-view-writing-step')?.textContent).toContain('●');
    generation.next({ type: 'document', run });
    await settle();
    expect(query('mktg-document-view-writing-step')?.textContent).toContain('✓');
    expect(query('mktg-document-view-writing-step')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('✓');
    expect(query('mktg-document-view-storing-step')?.querySelector('[aria-hidden="true"]')?.textContent).toBe('●');
    expect(query('mktg-document-view-storing-step')?.getAttribute('aria-current')).toBe('step');
    expect(query('mktg-document-view-storing-step')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('● Storing revision 3');
    expect(query('mktg-document-view-generating')?.textContent).not.toContain('Sources read');
    expect(query('mktg-document-view-generating')?.textContent).not.toContain('Building the slides');
  });

  it('shows only progress on a first run and opens the exact receipt revision when it lands', async () => {
    const request = { projectUid: PROJECT.uid, agentId: 'brand-kit', intake: BRAND_KIT_INTAKE, answers: {} };
    runService.takePreparedGeneration.mockReturnValueOnce(request);
    store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    await render('/documents/brand-kit/living?generation=1');
    expect(query('mktg-document-view-generating')).not.toBeNull();
    expect(query('mktg-document-view-document')).toBeNull();
    expect(query('mktg-document-view-about')).toBeNull();
    expect(query('mktg-document-view-generating-title')?.textContent).toBe('Writing the TestOrbit Brand Kit');
    expect(query('mktg-document-view-generating-note')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'On a first run there is nothing below this card until the revision lands.'
    );
    expect(query('mktg-document-view-error')).toBeNull();
    generation.next({ type: 'persisted', location: { agentKey: 'brand-kit', documentId: 'living', revisionId: LATEST.id } });
    generation.complete();
    await settle();
    expect(store.getRevision).toHaveBeenLastCalledWith(PROJECT.uid, 'brand-kit', 'living', LATEST.id, false);
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-document')?.textContent).toContain('Revision 2');
    expect(TestBed.inject(Router).url).not.toContain('generation=');
  });

  it('keeps the previous revision visible, but cannot restore while generating', async () => {
    runService.resumeGeneration.mockReturnValue(generation);
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-generating')).not.toBeNull();
    expect(query('mktg-document-view-document')?.textContent).toContain('Revision 2');
    expect((query('mktg-document-view-restore-1') as HTMLButtonElement).disabled).toBe(true);
    expect(runService.generate).not.toHaveBeenCalled();
  });

  it('reports a failed run and cancels its polling on a project change', async () => {
    runService.resumeGeneration.mockReturnValueOnce(generation);
    await render('/documents/brand-kit/living');
    activeContext.set({ uid: 'proj-2', slug: 'orbit-two', name: 'Orbit Two' });
    await settle();
    expect(generation.observed).toBe(false);
    expect(query('mktg-document-view-error')).toBeNull();
  });

  it('keeps a failed pending run honest and retries polling rather than generating again', async () => {
    runService.resumeGeneration.mockReturnValueOnce(generation);
    runService.loadRun.mockReturnValue({ pendingAttempt: {} });
    await render('/documents/brand-kit/living');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('Synthetic result failure');
    generation.error(failure);
    await settle();
    expect(errorLog).toHaveBeenCalledWith('Marketing OS run failed', failure);
    errorLog.mockRestore();
    expect(query('mktg-document-view-intake-link')?.getAttribute('href')).toBe('/brand-kit');
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-error')?.textContent).toContain('could not finish');
    expect(query('mktg-document-view-document')?.textContent).toContain('Revision 2');
    runService.retryGeneration.mockReturnValueOnce(of({ type: 'persisted', location: { agentKey: 'brand-kit', documentId: 'living', revisionId: LATEST.id } }));
    query('mktg-document-view-retry')?.click();
    await settle();
    expect(runService.generate).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).url).toContain(`revision=${LATEST.id}`);
  });

  it('offers explicit retry for a failed run without automatically resuming it on document open', async () => {
    runService.loadRun.mockReturnValue({ failedAttempt: {} });
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-error')).toBeNull();
    expect(query('mktg-document-view-retry')?.textContent).toContain('Retry run');
    expect(query('mktg-document-view-retry-note')?.textContent?.trim()).toBe(
      'A previous run did not finish. Retry polls it again; no new generation is started.'
    );
    expect(runService.retryGeneration).not.toHaveBeenCalled();
  });

  it('labels a failed document read as Reload, not a pending run retry', async () => {
    store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-retry')?.textContent).toContain('Reload document');
    expect(query('mktg-document-view-retry-note')).toBeNull();
    query('mktg-document-view-retry')?.click();
    await settle();
    expect(runService.generate).not.toHaveBeenCalled();
    expect(query('mktg-document-view-document')).not.toBeNull();
  });

  it('revokes download URLs when the view is destroyed before the deferred cleanup fires', async () => {
    await render('/documents/brand-kit/living');
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:synthetic-download'), revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      query('mktg-document-view-download')?.click();
      expect(revoke).not.toHaveBeenCalled();
      harness.fixture.destroy();
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:synthetic-download');
      await vi.runAllTimersAsync();
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('never subscribes to generation when document access is denied', async () => {
    runService.resumeGeneration.mockReturnValue(generation);
    store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    await render('/documents/brand-kit/living');
    expect(generation.observed).toBe(false);
    expect(query('mktg-document-view-generating')).toBeNull();
    expect(query('mktg-document-view-error')?.textContent).toContain('write access');
  });

  it('shows the saved README-less note only in About this document', async () => {
    store.getRevision.mockReturnValueOnce(
      of({
        ...revisionResponse(LATEST),
        source: { sessionId: 'session-1', draftVersion: 1, intakeMode: 'form', readme: { fetched: false, skipReason: 'no-readme' } },
      })
    );
    await render('/documents/brand-kit/living');
    expect(query('mktg-document-view-about')?.textContent).toContain(MKTG_README_SKIP_NOTES['no-readme']);
  });

  it('opens the latest revision when no revision is asked for', async () => {
    await render('/documents/brand-kit/living');

    expect(store.getDocument).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', false);
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', LATEST.id, false);
    expect(query('mktg-document-view-title')?.textContent).toContain('TestOrbit Brand Kit');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 2 of 2');
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('latest');
    expect(query('mktg-document-view-restore-current')).toBeNull();
    expect(query('mktg-document-view-revision-label-2')?.classList.contains('truncate')).toBe(false);
    expect(query('mktg-document-view-revision-label-2')?.classList.contains('text-left')).toBe(true);
    expect(query('mktg-document-view-revision-2')?.classList.contains('justify-between')).toBe(false);
  });

  it.each([
    [revision(1, { origin: 'legacy' }), 'Generated by the Brand Kit Agent (stored before revisions existed)'],
    [revision(3, { origin: 'restored', restoredFromNumber: 1 }), 'Restored from v1'],
  ] as const)('keeps complete legacy/restored provenance visible (%#)', async (current, how) => {
    store.getRevision.mockReturnValueOnce(of({ ...revisionResponse(current), revisions: [current] }));
    await render('/documents/brand-kit/living');
    const label = query(`mktg-document-view-revision-label-${current.number}`);
    const provenance = query(`mktg-document-view-revision-how-${current.number}`);
    expect(label?.classList.contains('truncate')).toBe(false);
    expect(label?.hasAttribute('title')).toBe(false);
    expect(label?.firstElementChild?.classList.contains('block')).toBe(true);
    expect(provenance?.textContent).toBe(how);
    expect(provenance?.classList.contains('block')).toBe(true);
    expect(provenance?.classList.contains('whitespace-normal')).toBe(true);
    expect(provenance?.classList.contains('truncate')).toBe(false);
  });

  it('opens the revision in ?revision= and offers to restore it', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    expect(store.getDocument).not.toHaveBeenCalled();
    expect(store.getRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id, false);
    expect(query('mktg-document-view-revision-chip')?.textContent).toContain('Revision 1 of 2');
    expect(query('mktg-document-view-restore-current')?.textContent).toContain('Restore revision 1');
    expect(query('mktg-document-view-hash')?.textContent).toContain(OLDER.contentSha256);
  });

  it('says the document has no such revision on a 404', async () => {
    store.getRevision.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 404 })));
    await render('/documents/brand-kit/living?revision=legacy-' + 'f'.repeat(64));

    expect(query('mktg-document-view-error')?.textContent).toContain('This document has no such revision.');
    expect(query('mktg-document-view-document')).toBeNull();
  });

  it('asks for write access on a 403', async () => {
    store.getDocument.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 403 })));
    await render('/documents/icp/living');

    expect(query('mktg-document-view-error')?.textContent).toContain('You need write access to this project');
    expect(store.getRevision).not.toHaveBeenCalled();
  });

  it('restores the open revision and moves to the new latest revision', async () => {
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    query('mktg-document-view-restore-current')?.click();
    await settle();

    expect(store.restoreRevision).toHaveBeenCalledWith('proj-1', 'brand-kit', 'living', OLDER.id);
    expect(TestBed.inject(Router).url).toContain(`revision=${RESTORED.id}`);
    expect(store.getRevision).toHaveBeenLastCalledWith('proj-1', 'brand-kit', 'living', RESTORED.id, false);
    expect(query('mktg-document-view-notice')?.textContent).toContain('Revision 1 restored as revision 3, now the latest.');
  });

  it('keeps the revision and lets the user retry when a restore fails', async () => {
    store.restoreRevision.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 500 })));
    await render(`/documents/brand-kit/living?revision=${OLDER.id}`);

    query('mktg-document-view-restore-current')?.click();
    await settle();

    expect(query('mktg-document-view-error')?.textContent).toContain('Revision 1 could not be restored. Nothing was changed; try again.');
    expect(TestBed.inject(Router).url).toContain(`revision=${OLDER.id}`);
    expect((query('mktg-document-view-restore-current') as HTMLButtonElement | null)?.disabled).toBe(false);
  });
});
