// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MentorshipAcceptDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AcceptApplicationDialogComponent } from './accept-application-dialog.component';

describe('AcceptApplicationDialogComponent', () => {
  let fixture: ComponentFixture<AcceptApplicationDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const build = (data: MentorshipAcceptDialogData | undefined = { personName: 'Alex Rivera' }): void => {
    close = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AcceptApplicationDialogComponent],
      providers: [provideNoopAnimations(), { provide: DynamicDialogRef, useValue: { close } }, { provide: DynamicDialogConfig, useValue: { data } }],
    });

    fixture = TestBed.createComponent(AcceptApplicationDialogComponent);
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => build());

  it('names the applicant and offers both attendance types', () => {
    expect(element().querySelector('[data-testid="mentorship-admin-accept-dialog"]')?.textContent).toContain('Alex Rivera');
    expect(fixture.componentInstance['attendanceOptions'].map((option) => option.value)).toEqual(['full_time', 'part_time']);
  });

  it('ties the attendance label to its select', () => {
    const label = element().querySelector('label[for="accept-attendance-type"]');

    expect(label).not.toBeNull();
    expect(element().querySelector('#accept-attendance-type')).not.toBeNull();
  });

  it('stays open and closes with nothing until an attendance type is chosen', () => {
    const error = (): Element | null => element().querySelector('[data-testid="mentorship-admin-accept-attendance-error"]');
    expect(error()).toBeNull();

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-admin-accept-confirm"] button')?.click();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(fixture.componentInstance['form'].controls.attendanceType.touched).toBe(true);
    expect(error()?.textContent?.trim()).toBe('Choose an attendance type to accept the application.');
  });

  it('closes with the chosen attendance type', () => {
    fixture.componentInstance['form'].controls.attendanceType.setValue('part_time');
    fixture.componentInstance['onAccept']();

    expect(close).toHaveBeenCalledWith('part_time');
  });

  it('closes with no value when cancelled, so the caller writes nothing', () => {
    fixture.componentInstance['form'].controls.attendanceType.setValue('full_time');
    fixture.componentInstance['onCancel']();

    expect(close).toHaveBeenCalledWith();
  });

  it('renders without dialog data', () => {
    build(undefined);

    expect(element().querySelector('[data-testid="mentorship-admin-accept-dialog"]')).not.toBeNull();
  });
});
