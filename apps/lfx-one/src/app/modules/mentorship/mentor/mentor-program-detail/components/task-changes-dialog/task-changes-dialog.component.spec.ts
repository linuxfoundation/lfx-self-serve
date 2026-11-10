// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_MENTOR_TASK_CHANGES_REASON_MAX, MENTORSHIP_MENTOR_TASK_CHANGES_REASON_REQUIRED } from '@lfx-one/shared/constants';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskChangesDialogComponent } from './task-changes-dialog.component';

describe('TaskChangesDialogComponent', () => {
  let fixture: ComponentFixture<TaskChangesDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    close = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TaskChangesDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { menteeName: 'Hana Suzuki', taskName: 'Backpressure design note' } } },
      ],
    });

    fixture = TestBed.createComponent(TaskChangesDialogComponent);
    fixture.detectChanges();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const reason = () => fixture.componentInstance['form'].controls.reason;
  const submit = (): void => {
    element().querySelector<HTMLElement>('[data-testid="mentorship-task-changes-submit"]')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
  };

  it('names the mentee and the task, and says the mentee is emailed the reason', () => {
    const text = element().textContent ?? '';
    expect(text).toContain('Hana Suzuki');
    expect(text).toContain('Backpressure design note');
    expect(text).toContain('they are emailed this reason');
  });

  it('closes with the trimmed reason', () => {
    reason().setValue('  Add tests for the buffer.\n');
    submit();

    expect(close).toHaveBeenCalledWith('Add tests for the buffer.');
  });

  it.each([
    ['empty', ''],
    ['blank', '   \n '],
  ])('refuses an %s reason and shows why only after a submit', (_label, value) => {
    reason().setValue(value);
    fixture.detectChanges();
    expect(element().querySelector('[data-testid="mentorship-task-changes-reason-error"]')).toBeNull();

    submit();

    expect(close).not.toHaveBeenCalled();
    expect(element().querySelector('[data-testid="mentorship-task-changes-reason-error"]')?.textContent?.trim()).toBe(
      MENTORSHIP_MENTOR_TASK_CHANGES_REASON_REQUIRED
    );
  });

  it('refuses a reason past the character cap', () => {
    reason().setValue('x'.repeat(MENTORSHIP_MENTOR_TASK_CHANGES_REASON_MAX + 1));
    submit();

    expect(close).not.toHaveBeenCalled();
  });

  it('closes with no value when cancelled, so nothing is sent', () => {
    reason().setValue('an abandoned reason');
    element().querySelector<HTMLElement>('[data-testid="mentorship-task-changes-cancel"]')?.querySelector<HTMLButtonElement>('button')?.click();

    expect(close).toHaveBeenCalledWith();
  });
});
