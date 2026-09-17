// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MentorshipNoteRequest, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { EMPTY } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';
import { MentorApplicantsTabComponent } from './mentor-applicants-tab.component';

describe('MentorApplicantsTabComponent', () => {
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
    tasks: [
      {
        id: 'tsk_1',
        name: 'Resume',
        description: 'Upload the most recent version of your resume.',
        status: 'submitted',
        prerequisite: false,
        createdOn: '2026-05-14',
        updatedOn: '2026-09-01',
        hasSubmission: true,
      },
    ],
    ...overrides,
  });

  let fixture: ComponentFixture<MentorApplicantsTabComponent>;

  /**
   * Standard set: two pending rows the user can search across (Ifeoma / Diego), one
   * accepted row for the status-pill assertion, one declined row for the same.
   */
  const setup = (
    applicants: MentorshipProgramApplicant[] = [
      applicant({
        otherApplications: [{ programId: 'mp_apicurio_winter26', programName: 'Apicurio Registry', status: 'pending', tasksSubmitted: 1, tasksTotal: 3 }],
      }),
      applicant({ id: 'app_2', name: 'Diego Souza' }),
      applicant({ id: 'app_3', name: 'Aiko Tanaka', status: 'accepted' }),
      applicant({ id: 'app_4', name: 'Bob Wilson', status: 'declined' }),
    ]
  ): void => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorApplicantsTabComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        // The applicant-tasks-panel (rendered when a row expands) now injects the task
        // dialog service. Stub it so DialogService/AppRef never have to be constructed.
        {
          provide: MentorshipTaskDialogService,
          useValue: { openCreate: vi.fn().mockReturnValue(EMPTY), openCreateGroup: vi.fn().mockReturnValue(EMPTY), openEdit: vi.fn().mockReturnValue(EMPTY) },
        },
      ],
    });

    fixture = TestBed.createComponent(MentorApplicantsTabComponent);
    fixture.componentRef.setInput('applicants', applicants);
    fixture.detectChanges();
  };

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowIds = (): string[] =>
    Array.from(element().querySelectorAll<HTMLElement>('[data-testid^="mentorship-mentor-applicant-row-"]')).map((row) =>
      (row.getAttribute('data-testid') ?? '').replace('mentorship-mentor-applicant-row-', '')
    );
  const pill = (value: string): HTMLButtonElement | null =>
    element().querySelector<HTMLButtonElement>(`[data-testid="mentorship-mentor-applicants-status-pill-${value}"]`);

  beforeEach(() => setup());

  it('renders the mentor-facing columns from the design', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    // Same column shape as the admin sibling, minus the admin-only Skills / Score columns.
    expect(headers).toEqual(['Mentee', 'Term', 'Status', 'Application Dates', 'Other Active Applications', 'Actions']);
  });

  it('defaults the status pill to Pending and only shows pending rows', () => {
    // Applicants tab primarily surfaces pending applications — the design pins that as the
    // default view so a mentor doesn't have to click into it every visit.
    expect(fixture.componentInstance['statusFilter']()).toBe('pending');
    expect(rowIds()).toEqual(['app_1', 'app_2']);
    expect(pill('pending')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('switches to Accepted / Declined / All when the matching pill is clicked', () => {
    pill('accepted')?.click();
    fixture.detectChanges();
    expect(rowIds()).toEqual(['app_3']);
    expect(pill('accepted')?.getAttribute('aria-pressed')).toBe('true');

    pill('declined')?.click();
    fixture.detectChanges();
    expect(rowIds()).toEqual(['app_4']);

    // The "All" pill is keyed by `undefined` — the template falls back to the literal
    // `'all'` string for its testid, so the assertion pins that off-by-default mapping.
    pill('all')?.click();
    fixture.detectChanges();
    expect(rowIds()).toEqual(['app_1', 'app_2', 'app_3', 'app_4']);
  });

  it('filters rows by the search term across name and email', () => {
    fixture.componentInstance['form'].controls.search.setValue('diego');
    fixture.detectChanges();

    expect(rowIds()).toEqual(['app_2']);
  });

  it('resets the paginator offset when the status pill changes', () => {
    // PrimeNG keeps its own offset when the value array shrinks underneath it, so a
    // narrowing filter would otherwise leave the mentor on a page that no longer exists.
    fixture.componentInstance['first'].set(20);

    pill('accepted')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance['first']()).toBe(0);
  });

  it('resets the paginator offset when the search term changes', () => {
    fixture.componentInstance['first'].set(20);

    fixture.componentInstance['form'].controls.search.setValue('anything');
    fixture.detectChanges();

    expect(fixture.componentInstance['first']()).toBe(0);
  });

  it('renders the parent note draft in place of the note the row arrived with', () => {
    fixture.componentRef.setInput('noteDrafts', { app_2: 'a saved draft' });
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-applicant-note-app_2"]')?.textContent?.trim()).toBe('a saved draft');
    expect(element().querySelector('[data-testid="mentorship-mentor-applicant-note-app_1"]')?.textContent?.trim()).toBe('Add note');
  });

  it('asks the parent to open the note dialog rather than owning it itself', () => {
    const requests: MentorshipNoteRequest[] = [];
    fixture.componentInstance.noteRequested.subscribe((request) => requests.push(request));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-applicant-note-app_2"]')?.click();

    expect(requests).toEqual([{ personId: 'app_2', personName: 'Diego Souza' }]);
  });

  it('expands the tasks sub-table when View Tasks is clicked, and hides it on the second click', () => {
    expect(element().querySelector('[data-testid="mentorship-mentor-applicant-tasks-expanded-app_1"]')).toBeNull();

    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-applicant-view-tasks-app_1"]')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(element().querySelector('[data-testid="mentorship-mentor-applicant-tasks-expanded-app_1"]')).not.toBeNull();

    element().querySelector<HTMLElement>('[data-testid="mentorship-mentor-applicant-view-tasks-app_1"]')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
    expect(element().querySelector('[data-testid="mentorship-mentor-applicant-tasks-expanded-app_1"]')).toBeNull();
  });

  it('does not render View Tasks when the applicant has no assigned tasks', () => {
    setup([applicant({ id: 'app_no_tasks', tasks: undefined, tasksTotal: undefined })]);

    expect(element().querySelector('[data-testid="mentorship-mentor-applicant-view-tasks-app_no_tasks"]')).toBeNull();
  });

  it('lists only still-active other applications, dropping the rejections', () => {
    setup([
      applicant({
        otherApplications: [
          { programId: 'mp_apicurio_winter26', programName: 'Apicurio Registry', status: 'pending', tasksSubmitted: 1, tasksTotal: 3 },
          { programId: 'mp_thanos_summer26', programName: 'Thanos', status: 'graduated' },
          { programId: 'mp_declined', programName: 'Declined Program', status: 'declined' },
          { programId: 'mp_withdrawn', programName: 'Withdrawn Program', status: 'withdrawn' },
        ],
      }),
    ]);

    const shown = Array.from(element().querySelectorAll('[data-testid^="mentorship-mentor-applicant-other-application-"]')).map((link) =>
      (link.textContent ?? '').trim()
    );
    expect(shown).toEqual(['Apicurio Registry', 'Thanos']);
  });

  it('renders the empty message when the filter chain narrows to zero rows', () => {
    fixture.componentInstance['form'].controls.search.setValue('nobody-matches-this');
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-mentor-applicants-empty"]')?.textContent?.trim()).toBe('No applicants.');
    expect(rowIds()).toEqual([]);
  });
});
