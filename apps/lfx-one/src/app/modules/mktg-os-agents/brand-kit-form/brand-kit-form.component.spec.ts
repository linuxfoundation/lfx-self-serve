// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { BRAND_KIT_INTAKE_QUESTIONS } from '@lfx-one/shared/constants';
import { BrandKitResultResponse } from '@lfx-one/shared/interfaces';
import { BrandKitService } from '@services/brand-kit.service';
import { MktgAnswerMemoryService } from '@services/mktg-answer-memory.service';
import { MktgDependencyService } from '@services/mktg-dependency.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BrandKitFormComponent } from './brand-kit-form.component';

/**
 * Covers the generation poll/epoch/consecutive-error state machine (PR #1348
 * review): the `pollEpoch` stale-response guard on start-over, the interaction
 * between the 3-consecutive-error tolerance and the 30-attempt budget (a
 * success resets the error streak; the attempt budget never resets), and timer
 * cleanup. Timers are faked; BrandKitService is mocked; the polling loop under
 * test is the component's own.
 */
describe('BrandKitFormComponent — generation poll state machine', () => {
  const POLL_INTERVAL_MS = 10_000;
  const MAX_ATTEMPTS = 30;

  let fixture: ComponentFixture<BrandKitFormComponent>;
  let generate: ReturnType<typeof vi.fn>;
  let getResult: ReturnType<typeof vi.fn>;
  let remember: ReturnType<typeof vi.fn>;
  let notifyDocumentsChanged: ReturnType<typeof vi.fn>;

  const PENDING: BrandKitResultResponse = { status: 'pending' };

  // Carries a persistence receipt so ready is fully terminal here — the
  // receipt-less persistence-retry polling has its own describe block below.
  const READY: BrandKitResultResponse = {
    status: 'ready',
    documentMarkdown: '# Brand Kit',
    projectName: 'Test Project',
    project: 'test-project',
    version: 1,
    intakeMode: 'form',
    persistence: {
      s3_key: 'brand-kit/test-project/abc.md',
      content_sha256: 'abc',
      project: 'test-project',
      version: 1,
      intake_mode: 'form',
    },
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    generate = vi.fn(() => of({ sessionId: 'session-1', ownerToken: 'owner-1' }));
    getResult = vi.fn();
    remember = vi.fn();
    notifyDocumentsChanged = vi.fn();

    await TestBed.configureTestingModule({
      imports: [BrandKitFormComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: BrandKitService, useValue: { generate, getResult } },
        // The run's project scope: the uid the BFF persists the ready document under.
        { provide: ProjectContextService, useValue: { activeContextUid: () => 'proj-uid-1' } },
        // Cross-agent answer memory + the marketplace's staleness signal:
        // both are written by a submission, neither is exercised here.
        { provide: MktgAnswerMemoryService, useValue: { remember, load: () => ({}) } },
        { provide: MktgDependencyService, useValue: { notifyDocumentsChanged } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BrandKitFormComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Fills every intake control and clicks the rendered submit button (onSubmit is protected). */
  function submitGenerationForm(): void {
    const form = (fixture.componentInstance as unknown as { intakeForm: { get(key: string): { setValue(v: string): void } | null } }).intakeForm;
    for (const question of BRAND_KIT_INTAKE_QUESTIONS) {
      form.get(question.key)?.setValue('An answer');
    }
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (!submit) throw new Error('submit button not rendered');
    submit.click();
  }

  function component(): { result: () => BrandKitResultResponse | null; generating: () => boolean; errorMessage: () => string } {
    return fixture.componentInstance as unknown as { result: () => BrandKitResultResponse | null; generating: () => boolean; errorMessage: () => string };
  }

  it('transitions pending → ready and stops polling once the document arrives', () => {
    getResult.mockReturnValueOnce(of(PENDING)).mockReturnValueOnce(of(READY));

    submitGenerationForm();
    expect(getResult).toHaveBeenCalledTimes(1);
    expect(component().generating()).toBe(true);

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(getResult).toHaveBeenCalledTimes(2);
    expect(component().generating()).toBe(false);
    expect(component().result()).toEqual(READY);

    // Ready is terminal — no further polls are scheduled.
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(getResult).toHaveBeenCalledTimes(2);
  });

  it('scopes every result poll to the project captured at submit — the partition the BFF persists into', () => {
    getResult.mockReturnValueOnce(of(PENDING)).mockReturnValueOnce(of(READY));

    submitGenerationForm();
    vi.advanceTimersByTime(POLL_INTERVAL_MS);

    expect(getResult).toHaveBeenNthCalledWith(1, 'session-1', 'owner-1', 'proj-uid-1');
    expect(getResult).toHaveBeenNthCalledWith(2, 'session-1', 'owner-1', 'proj-uid-1');
  });

  /**
   * The Brand Kit is the first agent most users run, so its answers are the
   * ones every later intake would otherwise re-ask for — and its stored
   * document is what unlocks the agents that depend on it.
   */
  it('remembers the submitted answers for the project so a later agent’s intake can reuse them', () => {
    getResult.mockReturnValue(of(PENDING));

    submitGenerationForm();

    expect(remember).toHaveBeenCalledWith('proj-uid-1', 'brand-kit', expect.objectContaining({ github_url: 'An answer', project_name: 'An answer' }));
  });

  it('announces the stored document once it is PERSISTED, so the marketplace stops showing dependents as locked', () => {
    getResult.mockReturnValueOnce(of(PENDING)).mockReturnValueOnce(of(READY));

    submitGenerationForm();
    // Still pending — nothing is stored yet, so nothing to announce.
    expect(notifyDocumentsChanged).not.toHaveBeenCalled();

    vi.advanceTimersByTime(POLL_INTERVAL_MS);

    expect(notifyDocumentsChanged).toHaveBeenCalledExactlyOnceWith('proj-uid-1');
  });

  it('fails with a timeout message at the 30-attempt budget and never polls past it', () => {
    getResult.mockReturnValue(of(PENDING));

    submitGenerationForm();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * (MAX_ATTEMPTS + 5));

    expect(getResult).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(component().generating()).toBe(false);
    expect(component().errorMessage()).toContain('taking longer than expected');
  });

  it('tolerates up to 3 consecutive transient errors, and a success resets the streak', () => {
    getResult
      .mockReturnValueOnce(throwError(() => new Error('blip 1')))
      .mockReturnValueOnce(throwError(() => new Error('blip 2')))
      .mockReturnValueOnce(throwError(() => new Error('blip 3'))) // streak at the cap — still tolerated
      .mockReturnValueOnce(of(PENDING)) // success resets the streak
      .mockReturnValueOnce(throwError(() => new Error('blip 4'))) // streak restarts at 1
      .mockReturnValueOnce(of(READY));

    submitGenerationForm();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);

    expect(getResult).toHaveBeenCalledTimes(6);
    expect(component().errorMessage()).toBe('');
    expect(component().result()).toEqual(READY);
  });

  it('fails on the 4th consecutive error (3-error tolerance is exceeded, not the attempt budget)', () => {
    getResult.mockReturnValue(throwError(() => new Error('persistent failure')));

    submitGenerationForm();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 10);

    // Errors 1-3 are tolerated and reschedule; error 4 breaks the tolerance.
    expect(getResult).toHaveBeenCalledTimes(4);
    expect(component().generating()).toBe(false);
    expect(component().errorMessage()).toContain('Could not fetch the generation result');
  });

  it('errors consume the attempt budget too — mixed pending/error runs cap at 30 total polls', () => {
    // Alternate pending/error so the consecutive-error streak never trips; only
    // the shared attempt budget can end the run.
    let call = 0;
    getResult.mockImplementation(() => (call++ % 2 === 0 ? of(PENDING) : throwError(() => new Error('blip'))));

    submitGenerationForm();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * (MAX_ATTEMPTS + 5));

    expect(getResult).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(component().generating()).toBe(false);
    expect(component().errorMessage()).not.toBe('');
  });

  it('discards stale poll responses after start-over (pollEpoch guard) — a cancelled generation cannot resurrect', () => {
    getResult.mockReturnValueOnce(of(PENDING)).mockReturnValue(of(READY));

    submitGenerationForm();
    expect(getResult).toHaveBeenCalledTimes(1);

    // Start over bumps the epoch and clears the timer while a poll is scheduled.
    (fixture.componentInstance as unknown as { onStartOver: () => void }).onStartOver();
    expect(component().generating()).toBe(false);

    // The cleared timer never fires; nothing resurrects the cancelled run.
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(getResult).toHaveBeenCalledTimes(1);
    expect(component().result()).toBeNull();
    expect(component().generating()).toBe(false);
  });

  it('cleans up the pending poll timer on destroy — no polls fire after ngOnDestroy', () => {
    getResult.mockReturnValue(of(PENDING));

    submitGenerationForm();
    expect(getResult).toHaveBeenCalledTimes(1);

    fixture.destroy();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 3);
    expect(getResult).toHaveBeenCalledTimes(1);
  });
});

/**
 * Covers the bounded background persistence-retry polling (dec-brand-kit-storage-v2):
 * when a ready result arrives without a persistence receipt, the component keeps
 * polling up to the retry cap — and a transient poll ERROR while the document is
 * already displayed must consume one retry and reschedule instead of silently
 * abandoning the remaining budget (PR #1442 round-2 finding). Timers are faked;
 * BrandKitService is mocked; the polling loop under test is the component's own.
 */
describe('BrandKitFormComponent — persistence retry polling', () => {
  const POLL_INTERVAL_MS = 10_000;

  let fixture: ComponentFixture<BrandKitFormComponent>;
  let generate: ReturnType<typeof vi.fn>;
  let getResult: ReturnType<typeof vi.fn>;
  let remember: ReturnType<typeof vi.fn>;
  let notifyDocumentsChanged: ReturnType<typeof vi.fn>;

  const READY_WITHOUT_RECEIPT: BrandKitResultResponse = {
    status: 'ready',
    documentMarkdown: '# Brand Kit',
    projectName: 'Test Project',
    project: 'test-project',
    version: 1,
    intakeMode: 'form',
  };

  const READY_WITH_RECEIPT: BrandKitResultResponse = {
    ...READY_WITHOUT_RECEIPT,
    persistence: {
      s3_key: 'brand-kit/test-project/abc.md',
      content_sha256: 'abc',
      project: 'test-project',
      version: 1,
      intake_mode: 'form',
    },
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    generate = vi.fn(() => of({ sessionId: 'session-1', ownerToken: 'owner-1' }));
    getResult = vi.fn();
    remember = vi.fn();
    notifyDocumentsChanged = vi.fn();

    await TestBed.configureTestingModule({
      imports: [BrandKitFormComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: BrandKitService, useValue: { generate, getResult } },
        // The run's project scope: the uid the BFF persists the ready document under.
        { provide: ProjectContextService, useValue: { activeContextUid: () => 'proj-uid-1' } },
        // Cross-agent answer memory + the marketplace's staleness signal:
        // both are written by a submission, neither is exercised here.
        { provide: MktgAnswerMemoryService, useValue: { remember, load: () => ({}) } },
        { provide: MktgDependencyService, useValue: { notifyDocumentsChanged } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BrandKitFormComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Fills every intake control and clicks the rendered submit button (onSubmit is protected). */
  function submitForm(): void {
    const form = (fixture.componentInstance as unknown as { intakeForm: { get(key: string): { setValue(v: string): void } | null } }).intakeForm;
    for (const question of BRAND_KIT_INTAKE_QUESTIONS) {
      form.get(question.key)?.setValue('An answer');
    }
    fixture.detectChanges();
    const submit = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (!submit) throw new Error('submit button not rendered');
    submit.click();
  }

  function resultSignal(): BrandKitResultResponse | null {
    return (fixture.componentInstance as unknown as { result: () => BrandKitResultResponse | null }).result();
  }

  it('keeps retrying after a transient poll error while the document is displayed', () => {
    getResult
      .mockReturnValueOnce(of(READY_WITHOUT_RECEIPT)) // initial poll: ready, no receipt → schedules retry 1
      .mockReturnValueOnce(throwError(() => new Error('network blip'))) // retry 1 fails → must reschedule
      .mockReturnValueOnce(of(READY_WITH_RECEIPT)); // retry 2 succeeds with a receipt

    submitForm();
    expect(getResult).toHaveBeenCalledTimes(1);
    expect(resultSignal()).toEqual(READY_WITHOUT_RECEIPT);

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(getResult).toHaveBeenCalledTimes(2); // the failed retry

    // The regression: the error path used to return without rescheduling.
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(getResult).toHaveBeenCalledTimes(3);
    expect(resultSignal()).toEqual(READY_WITH_RECEIPT);

    // Receipt present — polling stops.
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(getResult).toHaveBeenCalledTimes(3);
  });

  it('never surfaces an error or clears the displayed document on retry failures', () => {
    getResult.mockReturnValueOnce(of(READY_WITHOUT_RECEIPT)).mockReturnValue(throwError(() => new Error('storage down')));

    submitForm();
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);

    expect(resultSignal()).toEqual(READY_WITHOUT_RECEIPT);
    const errorMessage = (fixture.componentInstance as unknown as { errorMessage: () => string }).errorMessage();
    expect(errorMessage).toBe('');
  });

  it('caps error-path persistence retries at the same 3-poll budget', () => {
    getResult.mockReturnValueOnce(of(READY_WITHOUT_RECEIPT)).mockReturnValue(throwError(() => new Error('storage down')));

    submitForm();
    expect(getResult).toHaveBeenCalledTimes(1);

    // 3 retry polls (all failing), then the budget is spent — no 5th call ever.
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 10);
    expect(getResult).toHaveBeenCalledTimes(4);
  });

  it('caps success-path persistence retries at 1 + 3 polls when every ready response is receipt-less', () => {
    // Every poll succeeds with a receipt-less ready — no error is ever thrown,
    // so only the ready-branch guard (`persistRetries >= MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS`)
    // can end the loop. This is the bucket-intentionally-unconfigured
    // environment: bounded retries, then stop (PR #1442 round-3 finding).
    getResult.mockReturnValue(of(READY_WITHOUT_RECEIPT));

    submitForm();
    expect(getResult).toHaveBeenCalledTimes(1);
    expect(resultSignal()).toEqual(READY_WITHOUT_RECEIPT);

    // 3 bounded background retries fire; the 4th response arrives with the
    // budget spent and schedules nothing — no 5th call, ever.
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 10);
    expect(getResult).toHaveBeenCalledTimes(4);

    // The document stays displayed and no error surfaces on this path.
    expect(resultSignal()).toEqual(READY_WITHOUT_RECEIPT);
    const errorMessage = (fixture.componentInstance as unknown as { errorMessage: () => string }).errorMessage();
    expect(errorMessage).toBe('');
  });

  it('never overlays a timeout error when persist-retry polls come back non-ready (Bugbot: fail after success)', () => {
    // After a receipt-less ready, a later poll can return a non-ready payload
    // (e.g. a stale `pending`). The regression: that response fell through to
    // the generation-timeout branch, which called failGeneration without
    // checking that the document is already displayed — polling with a frozen
    // retry count until the 30-attempt budget surfaced a spurious timeout
    // error over the rendered document. Non-ready responses must consume the
    // same bounded persist-retry budget as retry errors.
    const PENDING: BrandKitResultResponse = { status: 'pending' };
    getResult.mockReturnValueOnce(of(READY_WITHOUT_RECEIPT)).mockReturnValue(of(PENDING));

    submitForm();
    expect(getResult).toHaveBeenCalledTimes(1);
    expect(resultSignal()).toEqual(READY_WITHOUT_RECEIPT);

    // Far past the 30-attempt budget: 3 bounded retries fire (all pending),
    // then the budget is spent — no 5th call and, critically, no failGeneration.
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 40);
    expect(getResult).toHaveBeenCalledTimes(4);

    expect(resultSignal()).toEqual(READY_WITHOUT_RECEIPT);
    const errorMessage = (fixture.componentInstance as unknown as { errorMessage: () => string }).errorMessage();
    expect(errorMessage).toBe('');
  });
});
