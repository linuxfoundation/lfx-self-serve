// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MKTG_DOCUMENT_TYPES, MKTG_RUN_POLL } from '@lfx-one/shared/constants';
import { MktgDocumentDetailResponse, MktgDocumentRunProgress, User } from '@lfx-one/shared/interfaces';
import { MktgDocumentStoreService } from '@services/mktg-document-store.service';
import { UserService } from '@services/user.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MktgRunProgressComponent } from './mktg-run-progress.component';

describe('MktgRunProgressComponent', () => {
  const runId = 'c'.repeat(64);
  const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'living' && entry.agentKey === 'foundation-message');
  if (!type) throw new Error('Missing living fixture type');
  const run: MktgDocumentRunProgress = {
    project: 'synthetic-project',
    agentKey: type.agentKey,
    documentId: 'living',
    runId,
    state: 'writing',
    startedAt: '2026-10-28T10:00:00Z',
  };
  const detail = (runs: MktgDocumentRunProgress[] = [run]): MktgDocumentDetailResponse => ({
    project: run.project,
    type,
    documentId: run.documentId,
    revisions: [],
    approvedCurrent: null,
    runs,
  });
  let fixture: ComponentFixture<MktgRunProgressComponent>;
  const user = signal<User | null>({ sub: 'synthetic-creator' } as User);
  const read = vi.fn();
  const setup = async (platform = 'browser') => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    read.mockReset().mockReturnValue(of(detail()));
    user.set({ sub: 'synthetic-creator' } as User);
    await TestBed.configureTestingModule({
      imports: [MktgRunProgressComponent],
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: platform },
        { provide: UserService, useValue: { user } },
        { provide: MktgDocumentStoreService, useValue: { getDocument: read } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MktgRunProgressComponent);
    for (const [key, value] of Object.entries({ project: run.project, agentKey: run.agentKey, documentId: run.documentId, runId, runPage: true }))
      fixture.componentRef.setInput(key, value);
  };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  afterEach(() => {
    fixture?.destroy();
    vi.useRealTimers();
  });

  it.each(['writing', 'storing', 'questions', 'failed'] as const)('renders %s with the original document card wording', async (state) => {
    await setup();
    fixture.componentRef.setInput('runPage', false);
    read.mockReturnValue(of(detail([{ ...run, state, failureText: state === 'failed' ? '<script>synthetic reply</script>' : undefined }])));
    await fixture.whenStable();
    const headings = { failed: "wasn't finished", questions: 'Waiting for your answers', writing: 'Generating the asset', storing: 'Generating the asset' };
    expect(text()).toContain(headings[state]);
    if (state === 'storing') expect(text()).toContain('Saving the revision');
    if (state === 'failed') {
      expect(text()).toContain('<script>synthetic reply</script>');
      expect(fixture.nativeElement.querySelector('script')).toBeNull();
    }
  });

  it('keeps the document observer headless without rendering any live card or status', async () => {
    await setup();
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('headless', true);
    const observed = vi.fn();
    fixture.componentInstance.observed.subscribe(observed);
    await fixture.whenStable();
    expect(read).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('polls the same public record and emits only a current-document landing, never an inferred revision id', async () => {
    await setup();
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    await fixture.whenStable();
    const finished = detail([]);
    finished.revisions = [{ id: 'synthetic-stored', number: 1 } as MktgDocumentDetailResponse['revisions'][number]];
    read.mockReturnValue(of(finished));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, true, undefined, false, runId);
    expect(landed).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it.each(['discarded', 'superseded'] as const)('reads and renders the selected %s run instead of landing on an older document', async (state) => {
    await setup();
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    await fixture.whenStable();
    expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, false, undefined, false, runId);
    read.mockReturnValue(of({ ...detail([{ ...run, state }]), revisions: [{ id: 'synthetic-older', number: 1 }] }));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, true, undefined, false, runId);
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-progress-closed"]')).not.toBeNull();
    expect(text()).toContain(state === 'discarded' ? 'This run was discarded.' : 'A newer run replaced this one.');
    expect(fixture.nativeElement.querySelector('[data-testid="mktg-run-progress-live"]')).toBeNull();
    expect(landed).not.toHaveBeenCalled();
    const reads = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs * 3);
    expect(read).toHaveBeenCalledTimes(reads);
  });

  it('does not land when progress is unavailable or no stored document exists', async () => {
    await setup();
    read.mockReturnValue(of({ ...detail([]), progressUnavailable: true }));
    const landed = vi.fn();
    fixture.componentInstance.landed.subscribe(landed);
    await fixture.whenStable();
    expect(landed).not.toHaveBeenCalled();
    expect(text()).toContain('Could not fully refresh');
  });

  it.each([true, false])('emits terminal questions/failure once and refreshes a failed record only once (selected: %s)', async (selected) => {
    await setup();
    read.mockReturnValue(of(detail([{ ...run, state: 'failed', persistenceFailed: true }])));
    const failed = vi.fn();
    fixture.componentInstance.failed.subscribe(failed);
    fixture.componentRef.setInput('runAgentId', type.catalogAgentId);
    fixture.componentRef.setInput('runPage', false);
    fixture.componentRef.setInput('runId', selected ? runId : '');
    await fixture.whenStable();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    if (selected) {
      expect(read).toHaveBeenNthCalledWith(1, run.project, run.agentKey, run.documentId, false, undefined, false, runId);
      expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, false, runId, false, runId);
    } else {
      expect(read).toHaveBeenNthCalledWith(1, run.project, run.agentKey, run.documentId, false);
      expect(read).toHaveBeenLastCalledWith(run.project, run.agentKey, run.documentId, false, runId);
    }
    expect(text()).toContain('retries saving the existing result');
    const retry = vi.fn();
    fixture.componentInstance.retry.subscribe(retry);
    fixture.nativeElement.querySelector('[data-testid="mktg-document-view-progress-retry"] button').click();
    expect(retry).toHaveBeenCalledOnce();
    read.mockReturnValue(of(detail([{ ...run, state: 'questions' }])));
    const questions = vi.fn();
    fixture.componentInstance.questions.subscribe(questions);
    fixture.componentRef.setInput('refreshKey', 'refresh');
    fixture.componentRef.setInput('runPage', true);
    await fixture.whenStable();
    expect(questions).toHaveBeenCalledOnce();
    expect(text()).toContain('browser that started this run');
  });

  it('retains the last measured record on transient failure and fails closed on denied reads', async () => {
    await setup();
    await fixture.whenStable();
    read.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(fixture.componentInstance.selectedRun()?.runId).toBe(runId);
    read.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(fixture.componentInstance.selectedRun()).toBeNull();
    expect(fixture.componentInstance['readFailure']()).toContain('write access');
  });

  it('distinguishes loading, measured missing and denied progress without starting a run', async () => {
    await setup();
    const pending = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(pending);
    await fixture.whenStable();
    expect(text()).toContain('Loading run progress');
    pending.next(detail([]));
    await fixture.whenStable();
    expect(text()).toContain('This run could not be found');
    read.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    fixture.componentRef.setInput('refreshKey', 'denied');
    await fixture.whenStable();
    expect(text()).toContain('write access');
    expect(fixture.componentInstance.selectedRun()).toBeNull();
  });

  it('bounds unavailable reads and lets manual Refresh reset that budget', async () => {
    await setup();
    await fixture.whenStable();
    read.mockReturnValue(of({ ...detail(), progressUnavailable: true }));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs + MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(text()).toContain('Automatic checks are paused');
    const count = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.timeoutMs);
    expect(read).toHaveBeenCalledTimes(count);
    read.mockReturnValue(of(detail()));
    fixture.nativeElement.querySelector('[data-testid="mktg-document-view-refresh-progress"] button').click();
    await fixture.whenStable();
    expect(text()).not.toContain('Automatic checks are paused');
    expect(read).toHaveBeenCalledTimes(count + 1);
  });

  it('rejects invalid public selectors rather than inferring a completed revision', async () => {
    await setup();
    fixture.componentRef.setInput('runId', 'invalid-run');
    await fixture.whenStable();
    expect(read).not.toHaveBeenCalled();
    expect(text()).toContain('This run could not be found');
  });

  it('keeps the initial read in flight and exposes creator activity on the next authenticated cycle', async () => {
    await setup();
    user.set(null);
    const initial = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(initial);
    await fixture.whenStable();
    user.set({ sub: 'synthetic-creator' } as User);
    await fixture.whenStable();
    expect(initial.observed).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    const activity = [
      { id: 'synthetic-step', kind: 'checking' as const, label: 'Synthetic creator step', status: 'running' as const, startedAt: run.startedAt },
    ];
    initial.next(detail([{ ...run, activity }]));
    initial.complete();
    await fixture.whenStable();
    expect(text()).not.toContain('Synthetic creator step');
    read.mockReturnValue(of(detail([{ ...run, activity }])));
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    await fixture.whenStable();
    expect(text()).toContain('Synthetic creator step');
    const replacement = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(replacement);
    user.set({ sub: 'synthetic-other-reader' } as User);
    await fixture.whenStable();
    expect(replacement.observed).toBe(true);
    expect(text()).not.toContain('Synthetic creator step');
  });

  it('refreshes a public questions pause after the owner continues elsewhere', async () => {
    await setup();
    read.mockReturnValue(of(detail([{ ...run, state: 'questions' }])));
    await fixture.whenStable();
    expect(text()).toContain('Waiting for your answers');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenCalledOnce();
    read.mockReturnValue(of(detail()));
    fixture.nativeElement.querySelector('[data-testid="mktg-document-view-refresh-progress"] button').click();
    await fixture.whenStable();
    expect(read).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Writing…');
    expect(text()).not.toContain('Waiting for your answers');
    await vi.advanceTimersByTimeAsync(MKTG_RUN_POLL.intervalMs);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('cancels a previous reader on subject change and hides its creator feed immediately', async () => {
    await setup();
    const old = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(old);
    await fixture.whenStable();
    old.next(
      detail([{ ...run, activity: [{ id: 'synthetic-step', kind: 'checking', label: 'Synthetic creator step', status: 'running', startedAt: run.startedAt }] }])
    );
    await fixture.whenStable();
    expect(text()).toContain('Synthetic creator step');
    const replacement = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(replacement);
    user.set({ sub: 'synthetic-other-reader' } as User);
    await fixture.whenStable();
    expect(old.observed).toBe(false);
    expect(text()).not.toContain('Synthetic creator step');
    expect(replacement.observed).toBe(true);
  });

  it('cancels stale subject responses and never fetches in SSR or externally driven mode', async () => {
    await setup();
    const response = new Subject<MktgDocumentDetailResponse>();
    read.mockReturnValue(response);
    await fixture.whenStable();
    expect(response.observed).toBe(true);
    fixture.componentRef.setInput('polling', false);
    fixture.componentRef.setInput('snapshot', detail());
    await fixture.whenStable();
    expect(response.observed).toBe(false);
    expect(fixture.componentInstance.selectedRun()?.runId).toBe(runId);
    fixture.destroy();
    TestBed.resetTestingModule();
    await setup('server');
    await fixture.whenStable();
    expect(read).not.toHaveBeenCalled();
  });
});
