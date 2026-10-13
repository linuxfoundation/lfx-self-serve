// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_NEW_TERM_ID_PREFIX } from '@lfx-one/shared/constants';
import { MentorshipProgramTerm, MentorshipTermFormDialogData } from '@lfx-one/shared/interfaces';
import { parseMentorshipDateOnly, parseMentorshipMonthYear } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { EnrollTermDialogComponent } from './enroll-term-dialog.component';

describe('EnrollTermDialogComponent', () => {
  const pastTerm = (id: string): MentorshipProgramTerm => ({
    id,
    name: 'Term 1 - 2020',
    startDate: '2020-03-01',
    endDate: '2020-05-01',
    applicationStartDate: '2020-01-01',
    applicationEndDate: '2020-02-28',
  });

  let fixture: ComponentFixture<EnrollTermDialogComponent>;
  let close: ReturnType<typeof vi.fn>;

  const build = (data: MentorshipTermFormDialogData): void => {
    close = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [EnrollTermDialogComponent],
      providers: [provideNoopAnimations(), { provide: DynamicDialogRef, useValue: { close } }, { provide: DynamicDialogConfig, useValue: { data } }],
    });

    fixture = TestBed.createComponent(EnrollTermDialogComponent);
    fixture.detectChanges();
  };

  const component = () =>
    fixture.componentInstance as unknown as { minApplicationDate: () => Date | null; dateErrors: () => Record<string, string>; onSubmit: () => void };

  it('lets a saved term keep past dates and saves it with its id', () => {
    const saved = pastTerm('9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d');
    build({ mode: 'edit', term: saved });

    expect(component().minApplicationDate()).toBeNull();
    component().onSubmit();

    expect(close).toHaveBeenCalledWith(saved);
  });

  it('holds a term the wizard added but has not saved to the not-before-today rules', () => {
    build({ mode: 'edit', term: pastTerm(`${MENTORSHIP_NEW_TERM_ID_PREFIX}1`) });

    expect(component().minApplicationDate()).not.toBeNull();
    component().onSubmit();

    expect(close).not.toHaveBeenCalled();
    expect(component().dateErrors()['applicationStartDate']).toBe('Application start date cannot be before today.');
  });

  it('stamps a term it adds with the new-term id prefix', () => {
    build({ mode: 'add' });
    const year = String(new Date().getFullYear() + 2);
    const start = parseMentorshipMonthYear(`${year}-03-01`);
    const end = parseMentorshipMonthYear(`${year}-05-01`);
    fixture.componentInstance['form'].patchValue({
      name: `Term 1 - ${year}`,
      startMonth: start?.month,
      startYear: start?.year,
      endMonth: end?.month,
      endYear: end?.year,
      applicationStartDate: parseMentorshipDateOnly(`${year}-01-01`),
      applicationEndDate: parseMentorshipDateOnly(`${year}-02-15`),
    });

    component().onSubmit();

    expect(close).toHaveBeenCalledTimes(1);
    const term = close.mock.calls[0][0] as MentorshipProgramTerm;
    expect(term.id.startsWith(MENTORSHIP_NEW_TERM_ID_PREFIX)).toBe(true);
    expect(term).toMatchObject({
      startDate: `${year}-03-01`,
      endDate: `${year}-05-01`,
      applicationStartDate: `${year}-01-01`,
      applicationEndDate: `${year}-02-15`,
    });
  });
});
