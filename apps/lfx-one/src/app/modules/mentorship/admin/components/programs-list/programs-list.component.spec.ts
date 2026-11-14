// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { MENTORSHIP_PROGRAM_STATUS_LABELS, MENTORSHIP_PROGRAM_STATUSES } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProgramsListComponent } from './programs-list.component';

describe('ProgramsListComponent', () => {
  const create = () => {
    TestBed.overrideComponent(ProgramsListComponent, { set: { imports: [ReactiveFormsModule], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const fixture = TestBed.createComponent(ProgramsListComponent);
    fixture.componentRef.setInput('programs', []);
    return fixture;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProgramsListComponent] }).compileComponents();
  });

  it('shows the load error with Retry instead of the empty state, and emits retry', () => {
    const fixture = create();
    fixture.componentRef.setInput('loadError', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="mentorship-admin-programs-load-error"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="mentorship-programs-empty-state"]')).toBeNull();

    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);
    (fixture.componentInstance as unknown as { onRetry: () => void }).onRetry();
    expect(retried).toBe(1);
  });

  it('passes a card change up as changed, so the parent reloads the list', () => {
    const fixture = create();
    let changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);

    (fixture.componentInstance as unknown as { onProgramChanged: () => void }).onProgramChanged();

    expect(changed).toBe(1);
  });

  it('shows the empty state when there is no error', () => {
    const fixture = create();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="mentorship-admin-programs-load-error"]')).toBeNull();
    expect(root.querySelector('[data-testid="mentorship-programs-empty-state"]')).not.toBeNull();
  });

  it('builds the status filter from every program status', () => {
    const fixture = create();
    const options = (fixture.componentInstance as unknown as { statusOptions: { label: string; value: string | null }[] }).statusOptions;

    expect(options.slice(1).map((option) => option.value)).toEqual([...MENTORSHIP_PROGRAM_STATUSES]);
    expect(options.slice(1).map((option) => option.label)).toEqual(MENTORSHIP_PROGRAM_STATUSES.map((status) => MENTORSHIP_PROGRAM_STATUS_LABELS[status]));
  });
});
