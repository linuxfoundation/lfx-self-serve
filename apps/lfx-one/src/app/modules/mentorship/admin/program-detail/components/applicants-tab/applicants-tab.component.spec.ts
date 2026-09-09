// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MentorshipNoteRequest, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it } from 'vitest';

import { ApplicantsTabComponent } from './applicants-tab.component';

describe('ApplicantsTabComponent', () => {
  const applicant = (overrides: Partial<MentorshipProgramApplicant> = {}): MentorshipProgramApplicant => ({
    id: 'app_1',
    name: 'Ifeoma Adeyemi',
    email: 'ifeoma.adeyemi@example.com',
    status: 'pending',
    termName: 'Fall 2026',
    createdOn: '2026-06-28',
    updatedOn: '2026-07-02',
    tasksSubmitted: 2,
    tasksTotal: 5,
    ...overrides,
  });

  let fixture: ComponentFixture<ApplicantsTabComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ApplicantsTabComponent],
      providers: [provideNoopAnimations(), provideRouter([]), MessageService],
    });

    fixture = TestBed.createComponent(ApplicantsTabComponent);
    fixture.componentRef.setInput('applicants', [
      applicant({
        otherApplications: [{ programId: 'mp_apicurio_winter26', programName: 'Apicurio Registry', status: 'pending', tasksSubmitted: 1, tasksTotal: 3 }],
      }),
      // Same `pending` status, but every prerequisite is in.
      applicant({ id: 'app_2', name: 'Diego Souza', tasksSubmitted: 5, tasksTotal: 5 }),
      applicant({ id: 'app_3', name: 'Aiko Tanaka', status: 'graduated', termName: 'Spring 2026', tasksSubmitted: undefined, tasksTotal: undefined }),
    ]);
    fixture.detectChanges();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowText = (id: string): string => (element().querySelector(`[data-testid="mentorship-applicant-row-${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ');

  it('renders the columns from the design', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    expect(headers).toEqual(['Mentee', 'Term', 'Status', 'Application Dates', 'Other Active Applications', 'Actions']);
  });

  it('splits the pending status into Applied and Tasks Completed by prerequisite progress', () => {
    expect(rowText('app_1')).toContain('Applied');
    expect(rowText('app_1')).not.toContain('Tasks Completed');
    expect(rowText('app_2')).toContain('Tasks Completed');
  });

  it('shows the created and updated dates, and links out to other active applications', () => {
    expect(rowText('app_1')).toContain('Created: Jun 28, 2026');
    expect(rowText('app_1')).toContain('Updated: Jul 2, 2026');

    const link = element().querySelector<HTMLAnchorElement>('[data-testid="mentorship-applicant-other-application-mp_apicurio_winter26"]');
    expect(link?.textContent?.trim()).toBe('Apicurio Registry');
    expect(link?.getAttribute('href')).toBe('/mentorship/admin/mp_apicurio_winter26');
    expect(rowText('app_1')).toContain('— Applied');
  });

  it('explains the Applied / Tasks Completed split above the table', () => {
    const note = element().querySelector('[data-testid="mentorship-applicants-note"]')?.textContent ?? '';

    expect(note).toContain('Note:');
    expect(note).toContain('Tasks Completed');
  });

  it('filters by display status and by term', () => {
    const component = fixture.componentInstance;

    expect(component['statusOptions'].map((option) => option.label)).toEqual([
      'All statuses',
      'Applied',
      'Tasks Completed',
      'Accepted',
      'Declined',
      'Withdrawn',
      'Graduated',
    ]);
    expect(component['termOptions']().map((option) => option.label)).toEqual(['All terms', 'Fall 2026', 'Spring 2026']);

    // `tasks-completed` is a display status only — it must still match the pending row.
    component['form'].controls.status.setValue('tasks-completed');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['app_2']);

    component['form'].controls.status.reset(null);
    component['form'].controls.term.setValue('Spring 2026');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['app_3']);
  });

  it('offers accept / decline / withdraw, and never re-accepts a graduate', () => {
    const component = fixture.componentInstance;
    const labelsFor = (id: string): string[] =>
      component['rows']()
        .find((row) => row.id === id)
        ?.menuItems.map((item) => item.label ?? '') ?? [];

    expect(labelsFor('app_1')).toEqual(['Accept', 'Decline', 'Withdraw']);
    expect(labelsFor('app_3')).toEqual(['Decline', 'Withdraw']);
  });

  it('asks the parent to open the note rather than owning the dialog itself', () => {
    const requests: MentorshipNoteRequest[] = [];
    fixture.componentInstance.noteRequested.subscribe((request) => requests.push(request));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-applicant-note-app_2"]')?.click();

    expect(requests).toEqual([{ personId: 'app_2', personName: 'Diego Souza' }]);
  });

  it('renders the parent note draft in place of the note the row arrived with', () => {
    fixture.componentRef.setInput('noteDrafts', { app_2: 'a saved note' });
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-applicant-note-app_2"]')?.textContent?.trim()).toBe('a saved note');
    expect(element().querySelector('[data-testid="mentorship-applicant-note-app_1"]')?.textContent?.trim()).toBe('Add note');
  });
});
