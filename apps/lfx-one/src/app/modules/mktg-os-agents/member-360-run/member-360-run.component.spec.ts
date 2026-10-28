// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { member360DocumentType, member360Revision, MEMBER_360_STORED_DOCUMENT } from '../../../../../e2e/fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME } from '../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Member360Service } from '@services/member-360.service';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of, throwError, NEVER } from 'rxjs';
import { ConfirmationService, ConfirmEventType, MessageService } from 'primeng/api';
import { MktgRunAttemptService } from '@services/mktg-run-attempt.service';
import { MKTG_AGENT_INTAKES, MKTG_RUN_POLL, MEMBER_360_RUN_CEILING_MS, MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS } from '@lfx-one/shared/constants';
import { MktgPendingGeneration, Member360Result } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Member360RunComponent } from './member-360-run.component';

describe('Member360RunComponent', () => {
  let fixture: ComponentFixture<Member360RunComponent>;
  const context = {
    activeContext: signal({ uid: 'sample-project', name: 'Sample Foundation', slug: 'sample-foundation' }),
    activeContextUid: signal('sample-project'),
    activeProject: signal({ writer: true }),
    canWrite: signal(true),
  };
  const documents = {
    listDocuments: vi.fn<MktgDocumentStoreService['listDocuments']>(() => of({ project: 'sample-project', groups: [] })),
    getRevision: vi.fn(() => of(member360Revision())),
  };
  const capability = (): MktgPendingGeneration => ({
    request: {
      projectUid: 'sample-project',
      agentId: 'member-360',
      intake: MKTG_AGENT_INTAKES['member-360'],
      documentId: 'run-0123456789abcdef01234567',
      answers: {},
    },
    state: 'writing',
    updatedAt: new Date().toISOString(),
    attempt: {
      runId: 'b'.repeat(64),
      documentId: 'run-0123456789abcdef01234567',
      priorVersion: 0,
      session: { agentId: 'member-360', sessionId: 'session-1', ownerToken: 'synthetic-token' },
    },
  });
  const attempts = { load: vi.fn(), latestPending: vi.fn(), clear: vi.fn(), subject: () => 'synthetic-subject', save: vi.fn() };
  const run = {
    questions: vi.fn<Member360Service['questions']>(() => NEVER),
    answer: vi.fn<Member360Service['answer']>(() => of({ success: true })),
    generate: vi.fn<Member360Service['generate']>(() =>
      of({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567' })
    ),
    parseTracker: vi.fn(() => of({ filename: 'repeat.csv', rows: [{ company: SYNTHETIC_ORG_NAME }] })),
  };
  const confirmation = Object.assign(new ConfirmationService(), { confirm: vi.fn<ConfirmationService['confirm']>(), close: vi.fn() });
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(Member360RunComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  function button(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="member-360-run"] button');
  }
  beforeEach(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    context.canWrite.set(true);
    confirmation.confirm.mockClear();
    attempts.load.mockReset().mockReturnValue(capability());
    attempts.latestPending.mockReset().mockReturnValue(null);
    attempts.clear.mockClear();
    attempts.save.mockClear();
    run.questions.mockReset().mockReturnValue(NEVER);
    run.answer.mockReset().mockReturnValue(of({ success: true }));
    documents.listDocuments.mockReturnValue(of({ project: 'sample-project', groups: [] }));
    run.generate.mockReturnValue(of({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567' }));
    run.generate.mockClear();
    await TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfirmationService, useValue: confirmation },
        MessageService,
        { provide: Member360Service, useValue: run },
        { provide: MktgRunAttemptService, useValue: attempts },
        { provide: MktgDocumentStoreService, useValue: documents },
        { provide: ProjectContextService, useValue: context },
        { provide: UserService, useValue: { user: signal({ sub: 'synthetic-subject' }) } },
      ],
    }).compileComponents();
  });
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.useRealTimers();
  });
  it.each(['open', 'discard', 'finished'] as const)('handles an active-run conflict and the %s choice without rebuilding inputs', async (choice) => {
    await render();
    const conflict = {
      code: 'MKTG_RUN_ACTIVE',
      message: 'Your Member 360 run is in progress.',
      activeRunId: 'b'.repeat(64),
      state: 'writing',
      agentKey: 'member-360',
      documentId: 'run-' + 'a'.repeat(24),
      startedBy: 'Synthetic writer',
      startedByViewer: true,
      startedAt: '2026-10-19T12:00:00.000Z',
    };
    run.generate
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict })))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: conflict })));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture.componentInstance.form.controls.compare.setValue(false);
    button().click();
    const prompt = confirmation.confirm.mock.calls.at(-1)?.[0];
    expect(prompt).toMatchObject({ header: 'Your Member 360 run is in progress', acceptLabel: 'Discard and start over', rejectLabel: 'Open it' });
    const original = run.generate.mock.calls[0][0];
    const fresh = { ...conflict, activeRunId: 'c'.repeat(64), startedAt: '2026-10-19T13:00:00Z' };
    if (choice !== 'finished') run.generate.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: fresh })));
    const notice = vi.spyOn(TestBed.inject(MessageService), 'add');
    window.dispatchEvent(new Event('focus'));
    expect(run.generate).toHaveBeenNthCalledWith(3, original);
    expect(confirmation.confirm.mock.calls.at(-1)?.[0]).toBe(prompt);
    if (choice === 'finished') {
      expect(confirmation.close).toHaveBeenCalled();
      expect(notice).toHaveBeenCalledWith(expect.objectContaining({ detail: 'The earlier run has finished — yours started.' }));
      expect(navigate).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('focus'));
      expect(run.generate).toHaveBeenCalledTimes(3);
      return;
    }
    expect(prompt?.message).toContain('19 Oct 2026');
    if (choice === 'discard') {
      fixture.componentInstance.form.controls.window.setValue('6');
      prompt?.accept?.();
      prompt?.accept?.(); // One dialog cannot authorize two replacement starts.
      expect(run.generate).toHaveBeenCalledTimes(4);
      expect(run.generate).toHaveBeenNthCalledWith(2, original);
      expect(run.generate).toHaveBeenNthCalledWith(4, { ...original, discard: fresh.activeRunId });
      expect(navigate).not.toHaveBeenCalled();
    } else {
      prompt?.reject?.(ConfirmEventType.REJECT);
      expect(run.generate).toHaveBeenCalledTimes(3);
      expect(navigate).toHaveBeenCalledWith(
        expect.arrayContaining(['documents', 'member-360', conflict.documentId]),
        expect.objectContaining({ queryParams: expect.objectContaining({ run: fresh.activeRunId }) })
      );
    }
  });

  it('fixes the project and defaults to a twelve-month window with empty run history', async () => {
    await render();
    const project = fixture.nativeElement.querySelector('[data-testid="member-360-project"]');
    expect(project.textContent).toContain('Sample Foundation');
    const hint = project.querySelector('[data-testid="member-360-project-hint"]');
    expect(hint?.previousElementSibling?.textContent).toBe('Sample Foundation');
    expect(hint?.classList.contains('text-[13px]')).toBe(true);
    expect(project.classList.contains('gap-[10px]')).toBe(true);
    const trackersLabel = fixture.nativeElement.querySelector('[data-testid="member-360-trackers-label"]');
    expect(trackersLabel.classList.contains('flex')).toBe(false);
    const trackersHint = trackersLabel.querySelector('[data-testid="member-360-trackers-hint"]');
    expect(trackersHint?.previousElementSibling?.textContent).toBe('Trackers');
    expect(trackersHint?.previousSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(trackersHint?.previousSibling?.textContent).toBe(' ');
    expect(trackersHint?.classList.contains('font-normal')).toBe(true);
    expect(trackersHint?.classList.contains('text-gray-500')).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-upload-types"]').textContent).toBe('XLSX or CSV');
    expect(fixture.componentInstance.form.controls.window.value).toBe('12');
    expect(fixture.nativeElement.textContent).toContain('No Member 360 runs yet.');
    expect(button().disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('main')).toBeNull();
    const breadcrumb = fixture.nativeElement.querySelector('[data-testid="member-360-breadcrumb"]');
    expect(breadcrumb.textContent).toMatch(/Sample Foundation kit.*Member & sponsor kit.*Member 360/s);
    expect(breadcrumb.querySelectorAll('li:not([aria-hidden])')).toHaveLength(3);
    expect(breadcrumb.querySelectorAll('a')).toHaveLength(2);
    expect(breadcrumb.querySelector('[data-testid="mktg-breadcrumb-link-0"]')?.getAttribute('href')).toBe('/mktg-os-agents?project=sample-foundation');
    expect(breadcrumb.querySelector('[data-testid="mktg-breadcrumb-link-1"]')?.getAttribute('href')).toBe(
      '/mktg-os-agents/families/member-sponsor?project=sample-foundation'
    );
    const intake = fixture.nativeElement.querySelector('[data-testid="member-360-intake"]');
    expect(intake.querySelector('[data-testid="member-360-run"]')).not.toBeNull();
    expect(intake.textContent).toContain('Sources this run will use');
  });
  it('matches the board title, standard outlined upload and rightmost Create action with its storage note', async () => {
    await render();
    const root: HTMLElement = fixture.nativeElement;
    for (const token of ['font-display', 'font-light', 'text-xl', 'text-gray-900']) expect(root.querySelector('h1')?.classList.contains(token)).toBe(true);
    const upload = root.querySelector('[data-testid="member-360-upload"] button');
    expect(upload?.classList.contains('p-button-outlined')).toBe(true);
    expect(upload?.classList.contains('p-button-secondary')).toBe(true);
    expect(upload?.classList.contains('!border-dashed')).toBe(false);
    const create = root.querySelector('[data-testid="member-360-run"]');
    expect(create?.parentElement?.lastElementChild).toBe(create);
    expect(create?.previousElementSibling?.textContent).toContain(
      'About 5 to 10 minutes for 40 members. Saved as a new Member 360 report, with its workbook; nothing is overwritten.'
    );
    expect(button().textContent).toContain('Create Member 360');
    expect(button().classList.contains('p-button-outlined')).toBe(false);
    fixture.componentInstance['submitting'].set(true);
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain('Starting…');
    button().click();
    expect(run.generate).not.toHaveBeenCalled();
  });
  it.each(['uploading', 'historyLoading'] as const)('explains %s on press instead of disabling Create', async (state) => {
    await render();
    fixture.componentInstance[state].set(true);
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
    button().click();
    fixture.detectChanges();
    const error = fixture.nativeElement.querySelector('[data-testid="member-360-error"]');
    expect(error?.textContent).toContain(state === 'uploading' ? 'Wait for your trackers to finish parsing' : 'Wait for run history to finish loading');
    expect(error?.parentElement?.getAttribute('aria-live')).toBe('polite');
    expect(run.generate).not.toHaveBeenCalled();
  });
  it('creates the first run with No comparison and without requiring an optional tracker', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    expect(fixture.componentInstance.form.controls.compare.value).toBe(false);
    expect(button().disabled).toBe(false);
    button().click();
    fixture.detectChanges();
    expect(run.generate).toHaveBeenCalledWith({ project: 'sample-project', window: '12', compare: false, trackers: [] });
    expect(navigate).not.toHaveBeenCalled();
    expect(fixture.componentInstance.form.controls.trackers.value).toEqual([]);
  });
  it('presents tracker matches and source tiles as neutral information', async () => {
    await render();
    await fixture.componentInstance['upload']([new File([`company\n${SYNTHETIC_ORG_NAME}`], 'tracker.csv')]);
    fixture.detectChanges();
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    const summary = root.querySelector('[data-testid="member-360-tracker-summary"]');
    expect(summary?.textContent).toContain('1 row');
    expect(summary?.classList.contains('text-gray-500')).toBe(true);
    expect(summary?.className).not.toContain('emerald');
    const tiles = root.querySelectorAll('[data-testid="member-360-source-tile"]');
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) {
      for (const token of ['border', 'border-gray-200', 'bg-gray-50', 'text-gray-700']) expect(tile.classList.contains(token)).toBe(true);
      expect(tile.className).not.toContain('emerald');
    }
  });
  it('keeps fixed context parents for a shared URL without copying revision, tab or stale project', async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', children: [] }]);
    await router.navigateByUrl('/project/mktg-os-agents/member-360?project=old&revision=old&tab=old');
    await render();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('[data-testid="mktg-breadcrumb-link-1"]')?.getAttribute('href')).toBe(
      '/project/mktg-os-agents/families/member-sponsor?project=sample-foundation'
    );
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('Member 360');
  });
  it('names the comparison run and displays its real stored date', async () => {
    documents.listDocuments.mockReturnValue(
      of({ project: 'sample-project', groups: [{ type: member360DocumentType(), documents: [MEMBER_360_STORED_DOCUMENT] }] })
    );
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: 'project/mktg-os-agents', children: [{ path: 'member-360', component: Member360RunComponent }] }]);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/project/mktg-os-agents/member-360?project=stale&revision=old&tab=sources', Member360RunComponent);
    await harness.fixture.whenStable();
    const root = harness.routeNativeElement;
    expect(root?.querySelector(`[data-testid="member-360-run-history-${MEMBER_360_STORED_DOCUMENT.documentId}"]`)?.getAttribute('href')).toBe(
      `/project/mktg-os-agents/documents/member-360/${MEMBER_360_STORED_DOCUMENT.documentId}?project=sample-foundation`
    );
    expect(root?.querySelector('[data-testid="member-360-last-run"]')?.textContent).toContain('Last run Q3 2026, 1 Oct');
    expect(root?.querySelector('[data-testid="member-360-compare"]')?.textContent).toContain('Previous run: Q3 2026 (1 Oct)');
  });
  it('keeps duplicate filenames distinct and preserves focus after removing the middle file', async () => {
    await render();
    const chooser = fixture.nativeElement.querySelector('lfx-file-upload');
    await fixture.componentInstance['upload']([1, 2, 3].map(() => new File([`company\n${SYNTHETIC_ORG_NAME}`], 'repeat.csv')));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('lfx-file-upload')).toBe(chooser);
    expect(document.activeElement).toBe(chooser.querySelector('button'));
    const uploads = fixture.componentInstance.form.controls.trackers.value;
    expect(new Set(uploads.map((upload) => upload.id)).size).toBe(3);
    const retained: HTMLButtonElement = fixture.nativeElement.querySelector(`[data-testid="member-360-remove-${uploads[2].id}"] button`);
    retained.focus();
    fixture.componentInstance['remove'](uploads[1].id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector(`[data-testid="member-360-remove-${uploads[2].id}"] button`)).toBe(retained);
    expect(document.activeElement).toBe(retained);
    expect(retained.textContent).toContain('Remove');
    expect(retained.classList.contains('p-button-text')).toBe(true);
    expect(retained.classList.contains('p-button-outlined')).toBe(false);
  });
  it('explains an unavailable comparison instead of a generic server error', async () => {
    documents.listDocuments.mockReturnValue(
      of({ project: 'sample-project', groups: [{ type: member360DocumentType(), documents: [MEMBER_360_STORED_DOCUMENT] }] })
    );
    run.generate.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEMBER_360_COMPARISON_UNAVAILABLE' } })));
    await render();
    button().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Turn off comparison or retry.');
  });
  it('sends raw tracker bytes and project scope for entitled server parsing', () => {
    TestBed.overrideProvider(Member360Service, { useFactory: () => new Member360Service() });
    const api = TestBed.inject(Member360Service),
      http = TestBed.inject(HttpTestingController);
    const file = new File([`company\n${SYNTHETIC_ORG_NAME}`], 'tracker.csv', { type: 'text/csv' });
    const tracker = { filename: file.name, rows: [{ company: SYNTHETIC_ORG_NAME }] };
    let received: unknown;
    api.parseTracker('sample-project', file).subscribe((value) => {
      received = value;
    });
    const request = http.expectOne('/api/mktg-agents/member-360/tracker?project=sample-project');
    expect(request.request.headers.get('X-File-Name')).toBe('tracker.csv');
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(request.request.body).toBe(file);
    request.flush(tracker);
    expect(received).toEqual(tracker);
  });
  it('rejects a PDF selected through the chooser before any upload', async () => {
    await render();
    run.parseTracker.mockClear();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="member-360-upload"] input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['synthetic pdf'], 'tracker.pdf', { type: 'application/pdf' })] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(run.parseTracker).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-error"]').textContent).toContain('Only .xlsx or .csv trackers can be uploaded.');
    expect(fixture.componentInstance.form.controls.trackers.value).toEqual([]);
    expect(button().disabled).toBe(false);
  });
  it.each([`${'x'.repeat(201)}.csv`, 'folder/tracker.csv'])('explains an invalid filename separately from its accepted extension: %s', async (filename) => {
    await render();
    run.parseTracker.mockClear();
    await fixture.componentInstance['upload']([new File(['company'], filename)]);
    fixture.detectChanges();
    expect(run.parseTracker).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-error"]').textContent).toContain('Use a shorter file name without slashes.');
  });
  it('rejects a mixed batch before sending even the valid tracker', async () => {
    await render();
    run.parseTracker.mockClear();
    await fixture.componentInstance['upload']([new File(['company'], 'tracker.csv'), new File(['pdf'], 'tracker.pdf')]);
    expect(run.parseTracker).not.toHaveBeenCalled();
    expect(fixture.componentInstance.form.controls.trackers.value).toEqual([]);
  });
  it('shows the specific tracker validation reason from the BFF', async () => {
    run.parseTracker.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              code: 'VALIDATION_ERROR',
              error: 'Validation failed for tracker',
              errors: [{ field: 'tracker', message: 'Upload one tracker sheet per file.' }],
            },
          })
      )
    );
    await render();
    await fixture.componentInstance['upload']([new File(['csv'], 'tracker.csv')]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-error"]').textContent).toContain('Upload one tracker sheet per file.');
  });
  it('does not offer a form to non-writers', async () => {
    context.canWrite.set(false);
    await render();
    expect(button()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('You need write access');
  });
  it('stays on the run page and opens its document only after stored readiness', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    run.questions.mockReturnValueOnce(of({ status: 'pending', activity: [] })).mockReturnValue(of({ status: 'ready', stored: true }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    fixture.componentInstance.form.controls.compare.setValue(false);
    button().click();
    await fixture.whenStable();
    expect(run.generate).toHaveBeenCalledWith({ project: 'sample-project', window: '12', compare: false, trackers: [] });
    expect(navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-generating"]')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(navigate).toHaveBeenCalledWith(
      ['../documents/member-360', 'run-0123456789abcdef01234567'],
      expect.objectContaining({ queryParams: { revision: null, generation: null, run: 'b'.repeat(64) } })
    );
  });
  it('keeps the accepted capability after navigation without polling or navigating again', async () => {
    TestBed.overrideProvider(Member360Service, { useFactory: () => new Member360Service() });
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await render();
    fixture.componentInstance.form.controls.compare.setValue(false);
    button().click();
    const request = http.expectOne('/api/mktg-agents/member-360/generate');
    fixture.destroy();
    expect(request.cancelled).toBe(false);
    request.flush({ sessionId: 'session-1', ownerToken: 'synthetic-token', documentId: 'run-0123456789abcdef01234567', runId: 'b'.repeat(64) });
    expect(attempts.save).toHaveBeenCalledWith(expect.objectContaining({ state: 'writing' }), 'synthetic-subject');
    expect(sessionStorage.length).toBe(0);
    expect(navigate).not.toHaveBeenCalled();
    sessionStorage.clear();
  });
  it.each(['answer', 'send-error', 'already-answered', 'empty', 'failed', 'poll-error'] as const)('handles the %s run state on this page', async (state) => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const questions: Member360Result = {
      status: 'needs_input',
      questionsId: 'c'.repeat(64),
      questions: [
        {
          key: 'window',
          label: 'Window',
          question: 'Which window should this tracker cover?',
          why: 'Missing date.',
          suggestedAnswer: 'Use the current analysis window.',
          basis: [],
        },
      ],
    };
    if (state === 'empty') questions.questions = [];
    run.questions.mockReturnValue(of(state === 'failed' ? { status: 'failed', message: 'The agent ended without a report.' } : questions));
    if (state === 'poll-error') run.questions.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    if (state === 'send-error') run.answer.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    if (state === 'already-answered')
      run.answer.mockReturnValue(
        throwError(
          () => new HttpErrorResponse({ status: 409, error: { code: 'MKTG_RUN_ANSWERED', answeredBy: 'Synthetic writer', answeredAt: '2026-10-19T12:00:00Z' } })
        )
      );
    await render();
    fixture.componentInstance.form.controls.compare.setValue(false);
    button().click();
    await fixture.whenStable();
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    fixture.detectChanges();
    if (state === 'answer' || state === 'send-error' || state === 'already-answered') {
      expect(fixture.nativeElement.querySelector('[data-testid="member-360-questions"]').textContent).toContain('Member 360 needs your answers to finish.');
      fixture.nativeElement.querySelector('[data-testid="mktg-run-questions-send"] button').click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(run.answer).toHaveBeenCalledWith(expect.objectContaining({ attempt: capability().attempt }), 'c'.repeat(64), [
        { key: 'window', text: 'Use the current analysis window.', origin: 'accepted' },
      ]);
      expect(!!fixture.nativeElement.querySelector('[data-testid="mktg-run-questions"]')).toBe(state === 'send-error');
      if (state === 'already-answered') {
        expect(fixture.nativeElement.textContent).toContain('Synthetic writer already answered these — the agent is writing');
        expect(fixture.nativeElement.querySelector('[data-testid="member-360-generating"]')).not.toBeNull();
      }
    } else {
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-questions"]')).toBeNull();
      if (state === 'failed') expect(navigate).toHaveBeenCalledWith(['../documents/member-360', capability().request.documentId], expect.anything());
      if (state === 'empty') expect(fixture.nativeElement.textContent).toContain('The questions are not available yet.');
      if (state === 'poll-error') expect(fixture.nativeElement.textContent).toContain('could not be checked');
    }
  });
  it('restores this tab capability and slows polling past the ceiling without failing the run', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    attempts.latestPending.mockReturnValue({ documentId: capability().request.documentId, state: 'writing' });
    run.questions.mockReturnValue(of({ status: 'pending' }));
    await render();
    fixture.componentInstance['startedAt'].set(Date.now() - MEMBER_360_RUN_CEILING_MS);
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.initialDelayMs);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Still running');
    expect(run.generate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(MEMBER_360_NEEDS_INPUT_POLL_INTERVAL_MS);
    expect(run.questions).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['result']()?.status).toBe('pending');
  });
  it('reports a submission failure and allows retry', async () => {
    run.generate.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await render();
    fixture.componentInstance.form.controls.compare.setValue(false);
    button().click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('could not be started');
    expect(button().disabled).toBe(false);
  });
  it('explains a failed comparison on press without disabling Create, and keeps Retry history', async () => {
    documents.listDocuments.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await render();
    expect(button().disabled).toBe(false);
    button().click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="member-360-error"]')?.textContent).toContain('Choose No comparison or retry history.');
    expect(run.generate).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Run history could not be loaded');
    documents.listDocuments.mockReturnValue(of({ project: 'sample-project', groups: [] }));
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((element) =>
      element.textContent?.includes('Retry history')
    )!;
    retry.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
  });
});
