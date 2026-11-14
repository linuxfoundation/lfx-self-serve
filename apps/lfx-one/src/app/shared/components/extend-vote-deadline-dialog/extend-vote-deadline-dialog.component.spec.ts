// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { ExtendVoteDeadlineDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtendVoteDeadlineDialogComponent } from './extend-vote-deadline-dialog.component';

describe('ExtendVoteDeadlineDialogComponent', () => {
  let fixture: ComponentFixture<ExtendVoteDeadlineDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  function confirmButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="extend-vote-deadline-confirm"] button');
  }

  function cancelButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="extend-vote-deadline-cancel"] button');
  }

  function create(data: ExtendVoteDeadlineDialogData): void {
    close = vi.fn();
    TestBed.configureTestingModule({
      imports: [ExtendVoteDeadlineDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    });
    fixture = TestBed.createComponent(ExtendVoteDeadlineDialogComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  beforeEach(() => create({ voteName: 'Board ballot', currentEndTime: '2026-08-15T23:59:00.000Z', currentEndTimeTimezone: 'UTC' }));

  it('seeds the form from the vote’s current deadline and timezone', () => {
    const { close_date, close_time, timezone } = fixture.componentInstance.form.getRawValue();

    expect(close_time).toBe('11:59 PM');
    expect(timezone).toBe('UTC');
    expect([close_date?.getFullYear(), close_date?.getMonth(), close_date?.getDate()]).toEqual([2026, 7, 15]);
  });

  it('shows the vote name in the prompt', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="extend-vote-deadline-dialog"]').textContent).toContain('Board ballot');
  });

  it('starts with Confirm disabled — the seeded value equals the current deadline, not later than it', () => {
    expect(confirmButton().disabled).toBe(true);
  });

  it('Confirm is a no-op while disabled', async () => {
    confirmButton().click();
    await fixture.whenStable();

    expect(close).not.toHaveBeenCalled();
  });

  it('enables Confirm once a later date is chosen, and closes with the combined end_time/timezone', async () => {
    fixture.componentInstance.form.patchValue({ close_date: new Date(2026, 8, 1) });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(confirmButton().disabled).toBe(false);

    confirmButton().click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith({ end_time: '2026-09-01T23:59:00.000Z', end_time_timezone: 'UTC' });
  });

  it('keeps Confirm disabled for a malformed close time, even past the current deadline', async () => {
    fixture.componentInstance.form.patchValue({ close_date: new Date(2026, 8, 1), close_time: 'not a time' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(confirmButton().disabled).toBe(true);
  });

  it('Cancel closes with no result', async () => {
    cancelButton().click();
    await fixture.whenStable();

    expect(close).toHaveBeenCalledWith();
  });
});
