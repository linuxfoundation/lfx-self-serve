// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import {
  MentorshipNoteRequest,
  MentorshipProgramApplicant,
  MentorshipProgramTermRow,
  MentorshipTaskDialogAssignee,
  MentorshipTaskFormValue,
} from '@lfx-one/shared/interfaces';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipTaskDialogService } from '../../../../services/mentorship-task-dialog.service';
import { CurrentMenteesTabComponent } from './current-mentees-tab.component';

describe('CurrentMenteesTabComponent', () => {
  const mentee = (overrides: Partial<MentorshipProgramApplicant> = {}): MentorshipProgramApplicant => ({
    id: 'app_1',
    name: 'Ifeoma Adeyemi',
    email: 'ifeoma.adeyemi@example.com',
    status: 'pending',
    termId: 'trm_fall26',
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
      {
        id: 'tsk_2',
        name: 'Cover Letter',
        description: 'A letter to the program covering the following topics:',
        status: 'pending',
        prerequisite: true,
        createdOn: '2026-05-14',
        updatedOn: '2026-06-20',
      },
    ],
    ...overrides,
  });

  const term = (name: string, status: MentorshipProgramTermRow['status']): MentorshipProgramTermRow => ({
    id: `trm_${name}`,
    name,
    status,
    pending: 0,
    declined: 0,
    accepted: 0,
    graduated: 0,
    startDate: '2026-09-01',
    endDate: '2026-12-01',
    applicationStartDate: '2026-06-01',
    applicationEndDate: '2026-08-01',
  });

  let fixture: ComponentFixture<CurrentMenteesTabComponent>;
  let openCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openCreate = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CurrentMenteesTabComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        // Stub the dialog service so the spec never touches PrimeNG's DialogService,
        // and so we can assert on the exact assignee payload the tab hands off.
        { provide: MentorshipTaskDialogService, useValue: { openCreate, openEdit: vi.fn().mockReturnValue(of(undefined)) } },
      ],
    });

    fixture = TestBed.createComponent(CurrentMenteesTabComponent);
    fixture.componentRef.setInput('mentees', [
      mentee({
        otherApplications: [{ programId: 'mp_apicurio_winter26', programName: 'Apicurio Registry', status: 'pending', tasksSubmitted: 1, tasksTotal: 3 }],
      }),
      // Same `pending` status, but every prerequisite is in.
      mentee({ id: 'app_2', name: 'Diego Souza', tasksSubmitted: 5, tasksTotal: 5 }),
      mentee({ id: 'app_3', name: 'Samir Okafor', status: 'declined', termName: 'Winter 2027' }),
      mentee({ id: 'app_4', name: 'Alex Rivera', status: 'accepted' }),
      mentee({ id: 'app_5', name: 'Aiko Tanaka', status: 'graduated', tasksSubmitted: undefined, tasksTotal: undefined }),
    ]);
    fixture.componentRef.setInput('terms', [term('Fall 2026', 'open'), term('Winter 2027', 'open'), term('Spring 2026', 'closed')]);
    fixture.detectChanges();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowText = (id: string): string =>
    (element().querySelector(`[data-testid="mentorship-current-mentee-row-${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ');
  const rowFor = (id: string) => fixture.componentInstance['rows']().find((row) => row.id === id);
  const labelsFor = (id: string): string[] => rowFor(id)?.actions.map((action) => action.label) ?? [];

  it('renders the columns from the design', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    expect(headers).toEqual(['Mentee', 'Term', 'Status', 'Application Dates', 'Other Active Applications', 'Actions']);
  });

  it('names the real <table> element via aria-label', () => {
    expect(element().querySelector('table')?.getAttribute('aria-label')).toBe('Current Mentees');
  });

  it('splits the pending status into Applied and Tasks Completed', () => {
    expect(rowText('app_1')).toContain('Applied');
    expect(rowText('app_1')).not.toContain('Tasks Completed');
    expect(rowText('app_2')).toContain('Tasks Completed');
    expect(rowText('app_3')).toContain('Declined');
  });

  it('shows the created and updated dates, and links out to other active applications', () => {
    expect(rowText('app_1')).toContain('Created: Jun 28, 2026');
    expect(rowText('app_1')).toContain('Updated: Jul 2, 2026');

    const link = element().querySelector<HTMLAnchorElement>('[data-testid="mentorship-current-mentee-other-application-mp_apicurio_winter26"]');
    expect(link?.textContent?.trim()).toBe('Apicurio Registry');
    expect(link?.getAttribute('href')).toBe('/mentorship/admin/mp_apicurio_winter26');
    expect(rowText('app_1')).toContain('— Applied');
  });

  it('lists only still-active other applications, dropping the rejections', () => {
    fixture.componentRef.setInput('mentees', [
      mentee({
        otherApplications: [
          { programId: 'mp_apicurio_winter26', programName: 'Apicurio Registry', status: 'pending', tasksSubmitted: 1, tasksTotal: 3 },
          { programId: 'mp_thanos_summer26', programName: 'Thanos', status: 'graduated' },
          { programId: 'mp_declined', programName: 'Declined Program', status: 'declined' },
          { programId: 'mp_withdrawn', programName: 'Withdrawn Program', status: 'withdrawn' },
        ],
      }),
    ]);
    fixture.detectChanges();

    const shown = Array.from(element().querySelectorAll('[data-testid^="mentorship-current-mentee-other-application-"]')).map((link) =>
      (link.textContent ?? '').trim()
    );
    expect(shown).toEqual(['Apicurio Registry', 'Thanos']);
  });

  it('explains the Applied / Tasks Completed split above the table', () => {
    const note = element().querySelector('[data-testid="mentorship-current-mentees-note"]')?.textContent ?? '';

    expect(note).toContain('Note:');
    expect(note).toContain('Tasks Completed');
  });

  it('offers the statuses the table badges in the status filter, and only the open terms in the term filter', () => {
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
    expect(component['termOptions']().map((option) => option.label)).toEqual(['All open terms', 'Fall 2026', 'Winter 2027']);
  });

  it('filters on the displayed status, so Applied and Tasks Completed split the pending rows', () => {
    const component = fixture.componentInstance;

    component['form'].controls.status.setValue('applied');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['app_1']);

    component['form'].controls.status.setValue('tasks-completed');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['app_2']);

    component['form'].controls.status.setValue('declined');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['app_3']);

    component['form'].controls.status.reset(null);
    component['form'].controls.term.setValue('Winter 2027');
    fixture.detectChanges();
    expect(component['rows']().map((row) => row.id)).toEqual(['app_3']);
  });

  it('returns to the first page when a filter narrows the list', () => {
    const component = fixture.componentInstance;
    component['first'].set(10);

    component['form'].controls.search.setValue('Diego');

    expect(component['first']()).toBe(0);
  });

  it('offers the row actions each status allows', () => {
    expect(labelsFor('app_1')).toEqual(['Accept', 'Decline', 'Withdraw']);
    expect(labelsFor('app_3')).toEqual([]);
    expect(labelsFor('app_4')).toEqual(['Create task', 'Graduate', 'Decline', 'Withdraw']);
    expect(labelsFor('app_5')).toEqual([]);
  });

  it('keeps the Note link on a row with no actions left', () => {
    expect(element().querySelector('[data-testid="mentorship-current-mentee-note-app_5"]')).not.toBeNull();
  });

  it('asks the parent to open the note rather than owning the dialog itself', () => {
    const requests: MentorshipNoteRequest[] = [];
    fixture.componentInstance.noteRequested.subscribe((request) => requests.push(request));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-current-mentee-note-app_2"]')?.click();

    expect(requests).toEqual([{ personId: 'app_2', personName: 'Diego Souza' }]);
  });

  it('renders the parent note draft in place of the note the row arrived with', () => {
    fixture.componentRef.setInput('noteDrafts', { app_2: 'a saved note' });
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-current-mentee-note-app_2"]')?.textContent?.trim()).toBe('a saved note');
    expect(element().querySelector('[data-testid="mentorship-current-mentee-note-app_1"]')?.textContent?.trim()).toBe('Add note');
  });

  it('expands assigned tasks when View Tasks is clicked and hides prerequisite tasks by default', () => {
    expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();

    element().querySelector<HTMLElement>('[data-testid="mentorship-current-mentee-view-tasks-app_1"]')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_1"]')?.textContent).toContain('Resume');
    expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_2"]')).toBeNull();

    element().querySelector<HTMLElement>('[data-testid="mentorship-current-mentee-view-tasks-app_1"]')?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();
  });

  it('does not render View Tasks when the mentee has no assigned tasks', () => {
    fixture.componentRef.setInput('mentees', [mentee({ id: 'app_no_tasks', tasks: undefined, tasksTotal: undefined })]);
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="mentorship-current-mentee-view-tasks-app_no_tasks"]')).toBeNull();
  });

  it('routes a decision action to the coming-soon toast', () => {
    const addSpy = vi.spyOn(TestBed.inject(MessageService), 'add');
    const row = rowFor('app_1')!;

    fixture.componentInstance['onRowAction'](row, row.actions[0]);

    expect(openCreate).not.toHaveBeenCalled();
    expect((addSpy.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Accept Ifeoma Adeyemi');
  });

  it("opens the task-form dialog with just the row's mentee when Create task is picked", () => {
    const row = rowFor('app_4')!;

    fixture.componentInstance['onRowAction'](row, row.actions[0]);

    expect(openCreate).toHaveBeenCalledTimes(1);
    const arg = openCreate.mock.calls[0][0] as MentorshipTaskDialogAssignee;
    expect(arg.id).toBe('app_4');
    expect(arg.name).toBe('Alex Rivera');
  });

  it('leaves the toast silent when the task dialog is dismissed without a value', () => {
    const addSpy = vi.spyOn(TestBed.inject(MessageService), 'add');
    const row = rowFor('app_4')!;

    fixture.componentInstance['onRowAction'](row, row.actions[0]);

    expect(addSpy).not.toHaveBeenCalled();
  });

  it('routes the created task to the coming-soon toast until the write endpoint lands', () => {
    openCreate.mockReturnValue(
      of({
        taskId: undefined,
        name: 'Submit ingestion benchmark report',
        description: 'Upload the benchmark output.',
        requiresFileSubmission: false,
        assignedMenteeIds: ['app_4'],
      } satisfies MentorshipTaskFormValue)
    );
    const addSpy = vi.spyOn(TestBed.inject(MessageService), 'add');
    const row = rowFor('app_4')!;

    fixture.componentInstance['onRowAction'](row, row.actions[0]);

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect((addSpy.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Create task "Submit ingestion benchmark report" for Alex Rivera');
  });
});
