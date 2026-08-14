// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { BRAND_KIT_INTAKE_QUESTIONS } from '@lfx-one/shared/constants';
import { BrandKitResultResponse } from '@lfx-one/shared/interfaces';
import { BrandKitService } from '@services/brand-kit.service';
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

  const PENDING: BrandKitResultResponse = { status: 'pending' };

  const READY: BrandKitResultResponse = {
    status: 'ready',
    documentMarkdown: '# Brand Kit',
    projectName: 'Test Project',
    project: 'test-project',
    version: 1,
    intakeMode: 'form',
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    generate = vi.fn(() => of({ sessionId: 'session-1', ownerToken: 'owner-1' }));
    getResult = vi.fn();

    await TestBed.configureTestingModule({
      imports: [BrandKitFormComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: BrandKitService, useValue: { generate, getResult } }],
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
