// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MENTORSHIP_MENTEE_STATUS_LABELS, MENTORSHIP_MENTEE_STATUSES } from '@lfx-one/shared/constants';
import {
  MentorshipAdminMenteesQuery,
  MentorshipAdminMenteesResponse,
  MentorshipAdminTermOption,
  MentorshipApplicantTask,
  MentorshipNoteRequest,
  MentorshipProgramApplicant,
  MentorshipTaskDialogAssignee,
  MentorshipTaskFormValue,
} from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    ...overrides,
  });

  const tasks = (): MentorshipApplicantTask[] => [
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
  ];

  const term = (name: string, status: MentorshipAdminTermOption['status']): MentorshipAdminTermOption => ({ id: `trm_${name}`, name, status });

  const firstPage = (): MentorshipAdminMenteesResponse => ({
    data: [
      mentee({
        otherApplications: [{ programId: 'mp_apicurio_winter26', programName: 'Apicurio Registry', status: 'pending', tasksSubmitted: 1, tasksTotal: 3 }],
      }),
      // Same `pending` status, but every prerequisite is in.
      mentee({ id: 'app_2', name: 'Diego Souza', tasksSubmitted: 5, tasksTotal: 5 }),
      mentee({ id: 'app_3', name: 'Samir Okafor', status: 'declined', termName: 'Winter 2027' }),
      mentee({ id: 'app_4', name: 'Alex Rivera', status: 'accepted' }),
      mentee({ id: 'app_5', name: 'Aiko Tanaka', status: 'graduated', tasksSubmitted: undefined, tasksTotal: undefined }),
    ],
    total: 25,
  });

  let fixture: ComponentFixture<CurrentMenteesTabComponent>;
  let openCreate: ReturnType<typeof vi.fn>;
  let getProgramMentees: ReturnType<typeof vi.fn<(programId: string, query: MentorshipAdminMenteesQuery) => Observable<MentorshipAdminMenteesResponse>>>;
  let getApplicationTasks: ReturnType<typeof vi.fn<(applicationId: string) => Observable<MentorshipApplicantTask[]>>>;

  /** Runs the effects that start a read, then renders what it wrote. */
  const settle = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(() => {
    openCreate = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);
    getProgramMentees = vi.fn().mockReturnValue(of(firstPage()));
    getApplicationTasks = vi.fn().mockReturnValue(of(tasks()));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CurrentMenteesTabComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: MentorshipAdminService, useValue: { getProgramMentees, getApplicationTasks } },
        // Stub the dialog service so the spec never touches PrimeNG's DialogService,
        // and so we can assert on the exact assignee payload the tab hands off.
        { provide: MentorshipTaskDialogService, useValue: { openCreate, openEdit: vi.fn().mockReturnValue(of(undefined)) } },
      ],
    });

    fixture = TestBed.createComponent(CurrentMenteesTabComponent);
    fixture.componentRef.setInput('programId', 'prog_1');
    fixture.componentRef.setInput('terms', [term('Fall 2026', 'open'), term('Winter 2027', 'open'), term('Spring 2026', 'closed')]);
    settle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowText = (id: string): string =>
    (element().querySelector(`[data-testid="mentorship-current-mentee-row-${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ');
  const rowFor = (id: string) => fixture.componentInstance['rows']().find((row) => row.id === id);
  const labelsFor = (id: string): string[] => rowFor(id)?.actions.map((action) => action.label) ?? [];
  const lastQuery = (): MentorshipAdminMenteesQuery => getProgramMentees.mock.calls[getProgramMentees.mock.calls.length - 1][1];
  const clickViewTasks = (id: string): void => {
    element().querySelector<HTMLElement>(`[data-testid="mentorship-current-mentee-view-tasks-${id}"]`)?.querySelector<HTMLButtonElement>('button')?.click();
    settle();
  };

  it('renders the columns from the design', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    expect(headers).toEqual(['Mentee', 'Term', 'Status', 'Application Dates', 'Other Active Applications', 'Actions']);
  });

  it('names the real <table> element via aria-label', () => {
    expect(element().querySelector('table')?.getAttribute('aria-label')).toBe('Current Mentees');
  });

  it('reads the first page of the open-term applications for the program', () => {
    expect(getProgramMentees).toHaveBeenCalledTimes(1);
    expect(getProgramMentees).toHaveBeenCalledWith('prog_1', {
      type: 'current',
      search: undefined,
      status: undefined,
      termId: undefined,
      offset: 0,
      limit: 10,
    });
    expect(fixture.componentInstance['rows']().length).toBe(5);
    expect(fixture.componentInstance['total']()).toBe(25);
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
    getProgramMentees.mockReturnValue(
      of({
        data: [
          mentee({
            otherApplications: [
              { programId: 'mp_apicurio_winter26', programName: 'Apicurio Registry', status: 'pending', tasksSubmitted: 1, tasksTotal: 3 },
              { programId: 'mp_thanos_summer26', programName: 'Thanos', status: 'graduated' },
              { programId: 'mp_declined', programName: 'Declined Program', status: 'declined' },
              { programId: 'mp_withdrawn', programName: 'Withdrawn Program', status: 'withdrawn' },
            ],
          }),
        ],
        total: 1,
      })
    );
    fixture.componentInstance['onRetry']();
    settle();

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

  it('offers every wire status in the status filter, and only the open terms in the term filter', () => {
    const component = fixture.componentInstance;

    expect(component['statusOptions'].map((option) => option.label)).toEqual([
      'All statuses',
      ...MENTORSHIP_MENTEE_STATUSES.map((status) => MENTORSHIP_MENTEE_STATUS_LABELS[status]),
    ]);
    expect(component['termOptions']().map((option) => option.label)).toEqual(['All open terms', 'Fall 2026', 'Winter 2027']);
  });

  it('sends the chosen status upstream and returns to the first page', () => {
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    expect(lastQuery().offset).toBe(10);

    component['form'].controls.status.setValue('declined');
    settle();

    expect(lastQuery()).toMatchObject({ status: 'declined', offset: 0 });
  });

  it('sends the chosen term id upstream, and drops the filter when it is cleared', () => {
    const component = fixture.componentInstance;

    component['form'].controls.term.setValue('trm_Winter 2027');
    settle();
    expect(lastQuery()).toMatchObject({ termId: 'trm_Winter 2027', offset: 0 });

    component['form'].controls.term.setValue(null);
    settle();
    expect(lastQuery().termId).toBeUndefined();
  });

  it('waits for typing to pause before searching, sends it trimmed, and returns to the first page', () => {
    vi.useFakeTimers();
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    getProgramMentees.mockClear();

    component['form'].controls.search.setValue('Di');
    component['form'].controls.search.setValue('  Diego ');
    vi.advanceTimersByTime(100);
    settle();
    expect(getProgramMentees).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    settle();
    expect(getProgramMentees).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({ search: 'Diego', offset: 0 });
  });

  it('reads the page the paginator asks for', () => {
    fixture.componentInstance['onLazyLoad']({ first: 20 });
    settle();

    expect(lastQuery().offset).toBe(20);
  });

  it('shows an inline error with Retry when the read fails, and reads the same page again on Retry', () => {
    getProgramMentees.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance['onRetry']();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-current-mentees-load-error"]')).not.toBeNull();
    expect(element().querySelector('table')).toBeNull();

    getProgramMentees.mockReturnValue(of(firstPage()));
    element().querySelector<HTMLElement>('[data-testid="mentorship-admin-current-mentees-retry"]')?.querySelector<HTMLButtonElement>('button')?.click();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-current-mentees-load-error"]')).toBeNull();
    expect(fixture.componentInstance['rows']().length).toBe(5);
  });

  it('drops the answer of a read that a newer one has replaced', () => {
    const stale = new Subject<MentorshipAdminMenteesResponse>();
    getProgramMentees.mockReturnValueOnce(stale);
    fixture.componentInstance['onRetry']();
    settle();

    getProgramMentees.mockReturnValue(of({ data: [mentee({ id: 'app_new', name: 'New Person' })], total: 1 }));
    fixture.componentInstance['onRetry']();
    settle();
    stale.next(firstPage());
    settle();

    expect(fixture.componentInstance['rows']().map((row) => row.id)).toEqual(['app_new']);
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

    expect(requests).toEqual([{ personId: 'app_2', personName: 'Diego Souza', note: undefined }]);
  });

  it('hands the parent the note the row arrived with', () => {
    getProgramMentees.mockReturnValue(of({ data: [mentee({ id: 'app_n', name: 'Nia Okoye', note: 'from the server' })], total: 1 }));
    fixture.componentInstance['onRetry']();
    settle();
    const requests: MentorshipNoteRequest[] = [];
    fixture.componentInstance.noteRequested.subscribe((request) => requests.push(request));

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-current-mentee-note-app_n"]')?.click();

    expect(requests).toEqual([{ personId: 'app_n', personName: 'Nia Okoye', note: 'from the server' }]);
  });

  it('renders the parent note draft in place of the note the row arrived with', () => {
    fixture.componentRef.setInput('noteDrafts', { app_2: 'a saved note' });
    settle();

    expect(element().querySelector('[data-testid="mentorship-current-mentee-note-app_2"]')?.textContent?.trim()).toBe('a saved note');
    expect(element().querySelector('[data-testid="mentorship-current-mentee-note-app_1"]')?.textContent?.trim()).toBe('Add note');
  });

  describe('View Tasks', () => {
    it('reads no tasks until a row is expanded', () => {
      expect(getApplicationTasks).not.toHaveBeenCalled();
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();
    });

    it('reads the tasks of the expanded row only, and hides prerequisite tasks by default', () => {
      clickViewTasks('app_1');

      expect(getApplicationTasks).toHaveBeenCalledTimes(1);
      expect(getApplicationTasks).toHaveBeenCalledWith('app_1');
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_1"]')?.textContent).toContain('Resume');
      expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_2"]')).toBeNull();
    });

    it('collapses and re-expands from the cache without a second request', () => {
      clickViewTasks('app_1');
      clickViewTasks('app_1');
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();

      clickViewTasks('app_1');

      expect(getApplicationTasks).toHaveBeenCalledTimes(1);
      expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_1"]')).not.toBeNull();
    });

    it('shows a loading line while the read is in flight', () => {
      getApplicationTasks.mockReturnValue(new Subject<MentorshipApplicantTask[]>());

      clickViewTasks('app_1');

      expect(element().querySelector('[data-testid="mentorship-admin-current-mentees-tasks-loading"]')).not.toBeNull();
    });

    it('shows an inline error with Retry when the read fails, and reads again on Retry', () => {
      getApplicationTasks.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      clickViewTasks('app_1');
      expect(element().querySelector('[data-testid="mentorship-admin-current-mentees-tasks-load-error"]')).not.toBeNull();

      getApplicationTasks.mockReturnValue(of(tasks()));
      element()
        .querySelector<HTMLElement>('[data-testid="mentorship-admin-current-mentees-tasks-retry-app_1"]')
        ?.querySelector<HTMLButtonElement>('button')
        ?.click();
      settle();

      expect(getApplicationTasks).toHaveBeenCalledTimes(2);
      expect(element().querySelector('[data-testid="mentorship-admin-current-mentees-tasks-load-error"]')).toBeNull();
      expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_1"]')).not.toBeNull();
    });

    it('collapses every row and clears the cache when the table reloads', () => {
      clickViewTasks('app_1');

      fixture.componentInstance['onLazyLoad']({ first: 10 });
      settle();
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();

      clickViewTasks('app_1');
      expect(getApplicationTasks).toHaveBeenCalledTimes(2);
    });

    it('drops the answer of a read that finishes after the table reloaded', () => {
      const late = new Subject<MentorshipApplicantTask[]>();
      getApplicationTasks.mockReturnValue(late);
      clickViewTasks('app_1');

      fixture.componentInstance['onLazyLoad']({ first: 10 });
      settle();
      late.next(tasks());
      settle();

      expect(fixture.componentInstance['tasksByApplication']().has('app_1')).toBe(false);
    });

    it('keeps the newer read when an older one for the same row finishes late', () => {
      const older = new Subject<MentorshipApplicantTask[]>();
      const newer = new Subject<MentorshipApplicantTask[]>();
      getApplicationTasks.mockReturnValueOnce(older).mockReturnValueOnce(newer);
      clickViewTasks('app_1');

      fixture.componentInstance['onLazyLoad']({ first: 10 });
      settle();
      clickViewTasks('app_1');
      older.next([]);
      settle();

      expect(fixture.componentInstance['tasksByApplication']().get('app_1')?.status).toBe('loading');

      newer.next(tasks());
      settle();

      expect(fixture.componentInstance['tasksByApplication']().get('app_1')).toEqual({ status: 'loaded', tasks: tasks() });
    });

    it('does not render View Tasks when the mentee has no assigned tasks', () => {
      getProgramMentees.mockReturnValue(of({ data: [mentee({ id: 'app_no_tasks', tasksTotal: undefined, tasksSubmitted: undefined })], total: 1 }));
      fixture.componentInstance['onRetry']();
      settle();

      expect(element().querySelector('[data-testid="mentorship-current-mentee-view-tasks-app_no_tasks"]')).toBeNull();
    });
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
