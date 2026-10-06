// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MENTORSHIP_MENTEE_STATUS_LABELS, MENTORSHIP_MENTEE_STATUSES } from '@lfx-one/shared/constants';
import {
  MentorshipAdminApplicationStatusUpdate,
  MentorshipAdminMenteesQuery,
  MentorshipAdminDeclinePendingResponse,
  MentorshipAdminMenteesResponse,
  MentorshipAdminTaskUpdate,
  MentorshipAdminTermOption,
  MentorshipApplicantTask,
  MentorshipMentorTaskCreateRequest,
  MentorshipMentorTaskCreateResponse,
  MentorshipProgramApplicant,
  MentorshipTaskDialogAssignee,
  MentorshipTaskFormValue,
} from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MessageService, ToastMessageOptions } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeNoteDialogComponent } from '../../../../components/mentee-note-dialog/mentee-note-dialog.component';
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
  let openEdit: ReturnType<typeof vi.fn>;
  let updateTask: ReturnType<typeof vi.fn<(taskId: string, body: MentorshipAdminTaskUpdate) => Observable<MentorshipApplicantTask>>>;
  let getProgramMentees: ReturnType<typeof vi.fn<(programId: string, query: MentorshipAdminMenteesQuery) => Observable<MentorshipAdminMenteesResponse>>>;
  let getApplicationTasks: ReturnType<typeof vi.fn<(applicationId: string) => Observable<MentorshipApplicantTask[]>>>;
  let updateApplicationStatus: ReturnType<typeof vi.fn<(applicationId: string, body: MentorshipAdminApplicationStatusUpdate) => Observable<void>>>;
  let withdrawApplication: ReturnType<typeof vi.fn<(applicationId: string) => Observable<void>>>;
  let declinePendingForTerm: ReturnType<typeof vi.fn<(programId: string, termId: string) => Observable<MentorshipAdminDeclinePendingResponse>>>;
  let updateApplicationNote: ReturnType<typeof vi.fn<(applicationId: string, note: string) => Observable<void>>>;
  let createTasks: ReturnType<typeof vi.fn<(request: MentorshipMentorTaskCreateRequest) => Observable<MentorshipMentorTaskCreateResponse>>>;
  /** What the stubbed dialog service closes with: an attendance type for Accept, a term for Decline by Term, a note. */
  let dialogResult: unknown;
  let dialogOpen: ReturnType<typeof vi.fn>;

  /** Runs the effects that start a read, then renders what it wrote. */
  const settle = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(() => {
    openCreate = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);
    openEdit = vi.fn().mockReturnValue(of(undefined) satisfies Observable<MentorshipTaskFormValue | undefined>);
    updateTask = vi.fn();
    getProgramMentees = vi.fn().mockReturnValue(of(firstPage()));
    getApplicationTasks = vi.fn().mockReturnValue(of(tasks()));
    updateApplicationStatus = vi.fn().mockReturnValue(of(undefined));
    withdrawApplication = vi.fn().mockReturnValue(of(undefined));
    declinePendingForTerm = vi.fn().mockReturnValue(of({ declinedCount: 4 }));
    updateApplicationNote = vi.fn().mockReturnValue(of(undefined));
    createTasks = vi.fn().mockReturnValue(of({ created: ['app_4'], failed: [] }));
    dialogResult = undefined;
    dialogOpen = vi.fn().mockImplementation(() => ({ onClose: of(dialogResult) }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CurrentMenteesTabComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        {
          provide: MentorshipAdminService,
          useValue: {
            getProgramMentees,
            getApplicationTasks,
            updateApplicationStatus,
            withdrawApplication,
            declinePendingForTerm,
            updateApplicationNote,
            createTasks,
            updateTask,
          },
        },
        { provide: DialogService, useValue: { open: dialogOpen } },
        // Stub the dialog service so the spec never touches PrimeNG's DialogService,
        // and so we can assert on the exact assignee payload the tab hands off.
        { provide: MentorshipTaskDialogService, useValue: { openCreate, openEdit } },
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

  describe('reviewer note', () => {
    const noteText = (id: string): string | undefined => element().querySelector(`[data-testid="mentorship-current-mentee-note-${id}"]`)?.textContent?.trim();
    const clickNote = (id: string): void => {
      element().querySelector<HTMLButtonElement>(`[data-testid="mentorship-current-mentee-note-${id}"]`)?.click();
      settle();
    };
    const showNote = (note: string): void => {
      getProgramMentees.mockReturnValue(of({ data: [mentee({ note })], total: 1 }));
      fixture.componentInstance['onRetry']();
      settle();
    };

    it('opens the note dialog on the note the row arrived with', () => {
      showNote('from the server');

      clickNote('app_1');

      expect(dialogOpen).toHaveBeenCalledWith(
        MenteeNoteDialogComponent,
        expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'from the server' } })
      );
    });

    it('sends the trimmed note for the application and writes it into the row', () => {
      dialogResult = '  needs a second look  ';

      clickNote('app_2');

      expect(updateApplicationNote).toHaveBeenCalledWith('app_2', 'needs a second look');
      expect(noteText('app_2')).toBe('needs a second look');
      expect(noteText('app_1')).toBe('Add note');
    });

    it('opens the dialog on the saved note the next time', () => {
      dialogResult = 'a saved note';
      clickNote('app_1');

      clickNote('app_1');

      expect(dialogOpen).toHaveBeenLastCalledWith(
        MenteeNoteDialogComponent,
        expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'a saved note' } })
      );
    });

    it('sends an empty note to clear the one the row arrived with', () => {
      showNote('from the server');
      dialogResult = '';

      clickNote('app_1');

      expect(updateApplicationNote).toHaveBeenCalledWith('app_1', '');
      expect(noteText('app_1')).toBe('Add note');
    });

    it('does not send a note that did not change', () => {
      showNote('from the server');
      dialogResult = ' from the server ';

      clickNote('app_1');

      expect(updateApplicationNote).not.toHaveBeenCalled();
    });

    it('sends nothing when the dialog is dismissed', () => {
      clickNote('app_1');

      expect(updateApplicationNote).not.toHaveBeenCalled();
      expect(noteText('app_1')).toBe('Add note');
    });

    it('keeps the note the row had when the save fails', () => {
      showNote('from the server');
      dialogResult = 'a new note';
      updateApplicationNote.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      clickNote('app_1');

      expect(noteText('app_1')).toBe('from the server');
    });

    it('keeps the dialog shut while that row has a save in flight', () => {
      const pending = new Subject<void>();
      updateApplicationNote.mockReturnValue(pending);
      dialogResult = 'first';

      clickNote('app_1');
      clickNote('app_1');

      expect(dialogOpen).toHaveBeenCalledTimes(1);

      pending.next();
      pending.complete();
      settle();
      clickNote('app_1');

      expect(noteText('app_1')).toBe('first');
      expect(dialogOpen).toHaveBeenCalledTimes(2);
    });

    it('keeps the dialog shut and lands the save in the tab rebuilt by a tab switch', () => {
      const pending = new Subject<void>();
      updateApplicationNote.mockReturnValue(pending);
      dialogResult = 'saved across the switch';
      clickNote('app_1');

      // The parent's `@switch` destroys the tab on a switch and builds a new one on the way back.
      fixture.destroy();
      fixture = TestBed.createComponent(CurrentMenteesTabComponent);
      fixture.componentRef.setInput('programId', 'prog_1');
      settle();
      clickNote('app_1');

      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(updateApplicationNote).toHaveBeenCalledTimes(1);

      pending.next();
      pending.complete();
      settle();

      expect(noteText('app_1')).toBe('saved across the switch');
    });

    it('keeps a save over the older answer of a read in flight when it landed', () => {
      const pending = new Subject<void>();
      updateApplicationNote.mockReturnValue(pending);
      dialogResult = 'saved mid-read';
      clickNote('app_1');

      // Back on the tab while the save is pending: the rebuilt tab's read answers only after the save lands.
      fixture.destroy();
      const staleRead = new Subject<MentorshipAdminMenteesResponse>();
      getProgramMentees.mockReturnValue(staleRead);
      fixture = TestBed.createComponent(CurrentMenteesTabComponent);
      fixture.componentRef.setInput('programId', 'prog_1');
      settle();

      pending.next();
      pending.complete();
      settle();
      staleRead.next({ data: [mentee({ note: 'before the save' })], total: 1 });
      staleRead.complete();
      settle();

      expect(noteText('app_1')).toBe('saved mid-read');
    });

    it('trusts a read that started after the save', () => {
      dialogResult = 'saved earlier';
      clickNote('app_1');

      showNote('changed since');

      expect(noteText('app_1')).toBe('changed since');
    });

    it('survives the dialog service declining to open a second dialog', () => {
      // PrimeNG returns null when a dialog of the same component is still registered.
      dialogOpen.mockReturnValue(null);

      expect(() => clickNote('app_1')).not.toThrow();
      expect(updateApplicationNote).not.toHaveBeenCalled();
    });
  });

  describe('View Tasks', () => {
    it('reads no tasks until a row is expanded', () => {
      expect(getApplicationTasks).not.toHaveBeenCalled();
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();
    });

    it('reads the tasks of the expanded row only, and shows prerequisite tasks by default', () => {
      clickViewTasks('app_1');

      expect(getApplicationTasks).toHaveBeenCalledTimes(1);
      expect(getApplicationTasks).toHaveBeenCalledWith('app_1');
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_1"]')?.textContent).toContain('Resume');
      expect(element().querySelector('[data-testid="mentorship-applicant-task-row-tsk_2"]')?.textContent).toContain('Cover Letter');
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

  describe('Edit task', () => {
    // tsk_1 is the only non-prerequisite task, so it is the one carrying the Edit button.
    const editValue = (overrides: Partial<MentorshipTaskFormValue> = {}): MentorshipTaskFormValue => ({
      taskId: 'tsk_1',
      name: tasks()[0].name,
      description: tasks()[0].description,
      requiresFileSubmission: false,
      assignedMenteeIds: [],
      status: 'submitted',
      ...overrides,
    });
    const savedTask = (overrides: Partial<MentorshipApplicantTask> = {}): MentorshipApplicantTask => ({ ...tasks()[0], ...overrides });
    const clickEdit = (taskId: string): void => {
      element().querySelector<HTMLElement>(`[data-testid="mentorship-applicant-task-edit-${taskId}"]`)?.querySelector<HTMLButtonElement>('button')?.click();
      settle();
    };
    const cachedTasks = () => fixture.componentInstance['tasksByApplication']().get('app_1');
    const submittedOf = (id: string): number | undefined => fixture.componentInstance['applications']().find((row) => row.id === id)?.tasksSubmitted;
    const taskRowText = (taskId: string): string => element().querySelector(`[data-testid="mentorship-applicant-task-row-${taskId}"]`)?.textContent ?? '';

    beforeEach(() => {
      clickViewTasks('app_1');
    });

    it('saves through the BFF and writes the saved task into the row without reading the list again', () => {
      openEdit.mockReturnValue(of(editValue({ name: 'Resume (final)' })));
      updateTask.mockReturnValue(of(savedTask({ name: 'Resume (final)' })));

      clickEdit('tsk_1');

      expect(updateTask).toHaveBeenCalledWith('tsk_1', { name: 'Resume (final)' });
      expect(getApplicationTasks).toHaveBeenCalledTimes(1);
      expect(getProgramMentees).toHaveBeenCalledTimes(1);
      expect(taskRowText('tsk_1')).toContain('Resume (final)');
    });

    it('keeps the list as it was when the save fails', () => {
      openEdit.mockReturnValue(of(editValue({ name: 'Resume (final)' })));
      updateTask.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));

      clickEdit('tsk_1');

      expect(updateTask).toHaveBeenCalledTimes(1);
      expect(cachedTasks()).toEqual({ status: 'loaded', tasks: tasks() });
      expect(taskRowText('tsk_1')).not.toContain('Resume (final)');
    });

    it("moves the row's submitted count with a status change, which Graduate's warning reads", () => {
      const patch = fixture.componentInstance['patchSavedTask'];
      expect(submittedOf('app_1')).toBe(2);

      patch('app_1', { ...tasks()[1], status: 'completed' });
      expect(submittedOf('app_1')).toBe(3);

      patch('app_1', { ...tasks()[1], status: 'in-progress' });
      expect(submittedOf('app_1')).toBe(2);

      patch('app_1', { ...tasks()[1], status: 'in-progress', name: 'Cover Letter v2' });
      expect(submittedOf('app_1')).toBe(2);
    });

    it('never takes the submitted count below zero', () => {
      const patch = fixture.componentInstance['patchSavedTask'];
      getProgramMentees.mockReturnValue(of({ data: [mentee({ tasksSubmitted: 0 })], total: 1 }));
      fixture.componentInstance['onLazyLoad']({ first: 10 });
      settle();
      clickViewTasks('app_1');

      patch('app_1', { ...tasks()[0], status: 'pending' });

      expect(submittedOf('app_1')).toBe(0);
    });

    it('drops a save that lands after the table reloaded, since the reload brought the newer tasks', () => {
      const patch = fixture.componentInstance['patchSavedTask'];
      fixture.componentInstance['onLazyLoad']({ first: 10 });
      settle();
      expect(cachedTasks()).toBeUndefined();

      patch('app_1', savedTask({ status: 'completed' }));

      expect(cachedTasks()).toBeUndefined();
      expect(getApplicationTasks).toHaveBeenCalledTimes(1);
    });

    it('lands a save for a row that was collapsed mid-save', () => {
      const response = new Subject<MentorshipApplicantTask>();
      openEdit.mockReturnValue(of(editValue({ name: 'Resume (final)' })));
      updateTask.mockReturnValue(response);
      clickEdit('tsk_1');
      clickViewTasks('app_1');
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();

      response.next(savedTask({ name: 'Resume (final)' }));
      response.complete();
      clickViewTasks('app_1');

      expect(taskRowText('tsk_1')).toContain('Resume (final)');
      expect(getApplicationTasks).toHaveBeenCalledTimes(1);
    });
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

  describe('Create task', () => {
    const formValue = (overrides: Partial<MentorshipTaskFormValue> = {}): MentorshipTaskFormValue => ({
      taskId: undefined,
      name: 'Submit ingestion benchmark report',
      description: 'Upload the benchmark output.',
      requiresFileSubmission: false,
      assignedMenteeIds: ['app_4'],
      ...overrides,
    });
    const createFor = (id: string): void => {
      const row = rowFor(id)!;
      fixture.componentInstance['onRowAction'](row, row.actions.find((action) => action.value === 'create-task')!);
      settle();
    };

    it('creates nothing when the dialog is dismissed', () => {
      createFor('app_4');

      expect(createTasks).not.toHaveBeenCalled();
    });

    it('sends one application with the form values, then reloads the page and tells the parent', () => {
      openCreate.mockReturnValue(of(formValue({ dueOn: '2026-09-30', requiresFileSubmission: true })));
      const emitted = vi.fn();
      fixture.componentRef.setInput('countsRefresh', emitted);
      const reads = getProgramMentees.mock.calls.length;

      createFor('app_4');

      expect(createTasks).toHaveBeenCalledTimes(1);
      expect(createTasks).toHaveBeenCalledWith({
        applicationIds: ['app_4'],
        name: 'Submit ingestion benchmark report',
        description: 'Upload the benchmark output.',
        dueDate: '2026-09-30',
        requiresFileSubmission: true,
      });
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(getProgramMentees.mock.calls.length).toBe(reads + 1);
    });

    it('reloads the page and the counts after a failure, which may still have created the task', () => {
      clickViewTasks('app_4');
      openCreate.mockReturnValue(of(formValue()));
      createTasks.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
      const emitted = vi.fn();
      fixture.componentRef.setInput('countsRefresh', emitted);
      const reads = getProgramMentees.mock.calls.length;

      createFor('app_4');

      expect(emitted).toHaveBeenCalledTimes(1);
      expect(getProgramMentees.mock.calls.length).toBe(reads + 1);
      expect(getApplicationTasks).toHaveBeenCalledTimes(2);
    });

    it('keeps the form shut while a decision is in flight', () => {
      withdrawApplication.mockReturnValue(new Subject<void>());
      const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
      const pendingRow = rowFor('app_1')!;
      fixture.componentInstance['onRowAction'](pendingRow, pendingRow.actions.find((action) => action.value === 'withdraw')!);
      confirm.mock.calls[0][0].accept?.();
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
      openCreate.mockReturnValue(of(formValue()));

      createFor('app_4');

      expect(withdrawApplication).toHaveBeenCalledTimes(1);
      expect(openCreate).not.toHaveBeenCalled();
      expect(createTasks).not.toHaveBeenCalled();
      expect((toast.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Please wait');
    });

    it('reads no tasks after creating one for a collapsed row', () => {
      openCreate.mockReturnValue(of(formValue()));

      createFor('app_4');

      expect(getApplicationTasks).not.toHaveBeenCalled();
    });

    it('keeps an expanded row expanded and reads its tasks once after the reload', () => {
      clickViewTasks('app_4');
      expect(getApplicationTasks).toHaveBeenCalledTimes(1);
      openCreate.mockReturnValue(of(formValue()));

      createFor('app_4');

      expect(getApplicationTasks).toHaveBeenCalledTimes(2);
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_4"]')).not.toBeNull();
    });

    it('reads the tasks only once when the row is collapsed and expanded again during the reload', () => {
      clickViewTasks('app_4');
      openCreate.mockReturnValue(of(formValue()));
      const reload = new Subject<ReturnType<typeof firstPage>>();
      getProgramMentees.mockReturnValue(reload);

      createFor('app_4');
      fixture.componentInstance['toggleTasksExpanded']('app_4');
      fixture.componentInstance['toggleTasksExpanded']('app_4');
      reload.next(firstPage());
      settle();

      expect(getApplicationTasks.mock.calls.map(([id]) => id)).toEqual(['app_4', 'app_4']);
    });

    it('collapses the other rows and drops their cached tasks', () => {
      clickViewTasks('app_1');
      clickViewTasks('app_4');
      openCreate.mockReturnValue(of(formValue()));

      createFor('app_4');

      expect(getApplicationTasks.mock.calls.map(([id]) => id)).toEqual(['app_1', 'app_4', 'app_4']);
      expect(element().querySelector('[data-testid="mentorship-current-mentee-tasks-expanded-app_1"]')).toBeNull();
    });

    it('asks the admin to wait while another write is in flight, and writes nothing', () => {
      const pending = new Subject<{ created: string[]; failed: string[] }>();
      createTasks.mockReturnValue(pending);
      openCreate.mockReturnValue(of(formValue()));
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');

      createFor('app_4');
      createFor('app_4');

      expect(createTasks).toHaveBeenCalledTimes(1);
      expect((toast.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Please wait');
    });

    it('keeps the form shut in the tab rebuilt by a tab switch while the create is in flight', () => {
      const pending = new Subject<{ created: string[]; failed: string[] }>();
      createTasks.mockReturnValue(pending);
      openCreate.mockReturnValue(of(formValue()));
      createFor('app_4');

      // The parent's `@switch` destroys the tab on a switch and builds a new one on the way back.
      fixture.destroy();
      fixture = TestBed.createComponent(CurrentMenteesTabComponent);
      fixture.componentRef.setInput('programId', 'prog_1');
      settle();
      const toast = vi.spyOn(TestBed.inject(MessageService), 'add');
      createFor('app_4');

      expect(openCreate).toHaveBeenCalledTimes(1);
      expect(createTasks).toHaveBeenCalledTimes(1);
      expect((toast.mock.calls[0][0] as ToastMessageOptions).summary).toBe('Please wait');

      pending.next({ created: ['app_4'], failed: [] });
      pending.complete();
      createTasks.mockReturnValue(of({ created: ['app_4'], failed: [] }));
      createFor('app_4');

      expect(openCreate).toHaveBeenCalledTimes(2);
      expect(createTasks).toHaveBeenCalledTimes(2);
    });

    it('offers no Create task on a pending row', () => {
      expect(labelsFor('app_1')).not.toContain('Create task');
    });
  });

  describe('application decisions', () => {
    const actionFor = (id: string, value: string) => rowFor(id)!.actions.find((action) => action.value === value)!;
    const confirmSpy = () => vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    const toasts = () => vi.spyOn(TestBed.inject(MessageService), 'add');
    const detailOf = (spy: ReturnType<typeof toasts>, call = 0) => (spy.mock.calls[call][0] as ToastMessageOptions).detail;
    /** Picks an action, then accepts the confirmation it raised. */
    const confirmAction = (id: string, value: string, spy: ReturnType<typeof confirmSpy>): void => {
      fixture.componentInstance['onRowAction'](rowFor(id)!, actionFor(id, value));
      spy.mock.calls[spy.mock.calls.length - 1][0].accept?.();
    };

    it('opens the accept dialog and writes nothing when it is dismissed', () => {
      fixture.componentInstance['onRowAction'](rowFor('app_1')!, actionFor('app_1', 'accept'));

      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(updateApplicationStatus).not.toHaveBeenCalled();
    });

    it('accepts with the attendance type the dialog returns, then reloads and tells the parent', () => {
      dialogResult = 'part_time';
      const toast = toasts();
      const emitted = vi.fn();
      fixture.componentRef.setInput('countsRefresh', emitted);
      const reads = getProgramMentees.mock.calls.length;

      fixture.componentInstance['onRowAction'](rowFor('app_1')!, actionFor('app_1', 'accept'));
      settle();

      expect(updateApplicationStatus).toHaveBeenCalledWith('app_1', { status: 'accepted', attendanceType: 'part_time' });
      expect(detailOf(toast)).toBe('Application accepted');
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(getProgramMentees.mock.calls.length).toBe(reads + 1);
    });

    it('declines and withdraws only after the confirmation is accepted', () => {
      const confirm = confirmSpy();

      fixture.componentInstance['onRowAction'](rowFor('app_1')!, actionFor('app_1', 'decline'));
      fixture.componentInstance['onRowAction'](rowFor('app_1')!, actionFor('app_1', 'withdraw'));
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(updateApplicationStatus).not.toHaveBeenCalled();
      expect(withdrawApplication).not.toHaveBeenCalled();

      confirm.mock.calls[0][0].accept?.();
      confirm.mock.calls[1][0].accept?.();

      expect(updateApplicationStatus).toHaveBeenCalledWith('app_1', { status: 'declined' });
      expect(withdrawApplication).toHaveBeenCalledWith('app_1');
    });

    it('warns with the outstanding task count on Graduate and never reads the tasks', () => {
      const confirm = confirmSpy();
      // The tasks were read for this row already; Graduate must ignore that cache and the row's own read.
      clickViewTasks('app_4');
      getApplicationTasks.mockClear();

      fixture.componentInstance['onRowAction'](rowFor('app_4')!, actionFor('app_4', 'graduate'));

      expect(confirm.mock.calls[0][0].message).toContain("3 tasks aren't Submitted or Completed.");
      expect(getApplicationTasks).not.toHaveBeenCalled();

      confirm.mock.calls[0][0].accept?.();
      expect(updateApplicationStatus).toHaveBeenCalledWith('app_4', { status: 'graduated' });
    });

    it('confirms Graduate without a warning when every task is in, and still lets it go through', () => {
      const confirm = confirmSpy();
      getProgramMentees.mockReturnValue(of({ data: [mentee({ id: 'app_9', status: 'accepted', tasksSubmitted: 5, tasksTotal: 5 })], total: 1 }));
      fixture.componentInstance['onRetry']();
      settle();

      fixture.componentInstance['onRowAction'](rowFor('app_9')!, actionFor('app_9', 'graduate'));

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0].message).not.toContain('tasks');
      confirm.mock.calls[0][0].accept?.();
      expect(updateApplicationStatus).toHaveBeenCalledWith('app_9', { status: 'graduated' });
    });

    it('uses the singular warning for one outstanding task', () => {
      const confirm = confirmSpy();
      getProgramMentees.mockReturnValue(of({ data: [mentee({ id: 'app_9', status: 'accepted', tasksSubmitted: 4, tasksTotal: 5 })], total: 1 }));
      fixture.componentInstance['onRetry']();
      settle();

      fixture.componentInstance['onRowAction'](rowFor('app_9')!, actionFor('app_9', 'graduate'));

      expect(confirm.mock.calls[0][0].message).toContain("1 task isn't Submitted or Completed.");
    });

    it('collapses an expanded row and clears its loaded tasks when a decision reloads the page', () => {
      const confirm = confirmSpy();
      clickViewTasks('app_4');
      expect(fixture.componentInstance['expandedTaskMenteeIds']()['app_4']).toBe(true);
      expect(fixture.componentInstance['tasksByApplication']().has('app_4')).toBe(true);

      confirmAction('app_4', 'decline', confirm);
      settle();

      expect(fixture.componentInstance['expandedTaskMenteeIds']()).toEqual({});
      expect(fixture.componentInstance['tasksByApplication']().size).toBe(0);
    });

    it('reloads with the changed message on a 409', () => {
      updateApplicationStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
      const toast = toasts();
      const confirm = confirmSpy();
      const reads = getProgramMentees.mock.calls.length;

      confirmAction('app_1', 'decline', confirm);
      settle();

      expect(detailOf(toast)).toBe('This application changed. The list has been refreshed.');
      expect(getProgramMentees.mock.calls.length).toBe(reads + 1);
    });

    it('shows the term-closed message on a 422 without reloading', () => {
      dialogResult = 'full_time';
      updateApplicationStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422 })));
      const toast = toasts();
      const emitted = vi.fn();
      fixture.componentRef.setInput('countsRefresh', emitted);
      const reads = getProgramMentees.mock.calls.length;

      fixture.componentInstance['onRowAction'](rowFor('app_1')!, actionFor('app_1', 'accept'));
      settle();

      expect(detailOf(toast)).toBe("This term is closed, so the application can't be accepted.");
      expect(getProgramMentees.mock.calls.length).toBe(reads);
      expect(emitted).not.toHaveBeenCalled();
    });

    it('shows the server read-only message on an impersonation 403', () => {
      withdrawApplication.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY', message: 'Read-only while impersonating.' } }))
      );
      const toast = toasts();
      const confirm = confirmSpy();

      confirmAction('app_1', 'withdraw', confirm);

      expect(detailOf(toast)).toBe('Read-only while impersonating.');
    });

    it('declines a term after its dialog and a confirmation, toasting the count', () => {
      dialogResult = term('Fall 2026', 'open');
      const toast = toasts();
      const confirm = confirmSpy();
      const emitted = vi.fn();
      fixture.componentRef.setInput('countsRefresh', emitted);

      fixture.componentInstance['onDeclineByTerm']();
      expect(declinePendingForTerm).not.toHaveBeenCalled();
      expect(confirm.mock.calls[0][0].message).toContain('Fall 2026');
      confirm.mock.calls[0][0].accept?.();

      expect(declinePendingForTerm).toHaveBeenCalledWith('prog_1', 'trm_Fall 2026');
      expect(detailOf(toast)).toBe('4 applications declined');
      expect(emitted).toHaveBeenCalledTimes(1);
    });

    it('escapes the term name in the confirmation, which PrimeNG renders as HTML', () => {
      dialogResult = { id: 'trm_x', name: '<b>Fall</b> & Co', status: 'open' } satisfies MentorshipAdminTermOption;
      const confirm = confirmSpy();

      fixture.componentInstance['onDeclineByTerm']();

      expect(confirm.mock.calls[0][0].message).toContain('&lt;b&gt;Fall&lt;/b&gt; &amp; Co');
    });

    it('refuses a second decision while one is in flight, and disables Decline by Term', () => {
      // The service observable is cold, so a request is sent per subscription, not per call.
      const pending = new Subject<void>();
      let sent = 0;
      updateApplicationStatus.mockImplementation(
        () =>
          new Observable<void>((subscriber) => {
            sent++;
            return pending.subscribe(subscriber);
          })
      );
      const toast = toasts();
      const confirm = confirmSpy();
      const declineByTerm = (): HTMLButtonElement | null =>
        element().querySelector<HTMLElement>('[data-testid="mentorship-admin-current-mentees-decline-by-term"]')?.querySelector('button') ?? null;

      confirmAction('app_1', 'decline', confirm);
      confirmAction('app_2', 'decline', confirm);
      settle();

      expect(sent).toBe(1);
      expect(detailOf(toast)).toBe('Another change is still being saved. Try again in a moment.');
      expect(declineByTerm()?.disabled).toBe(true);

      pending.next();
      pending.complete();
      settle();

      expect(declineByTerm()?.disabled).toBe(false);
    });

    it('shows the generic failure, not the term-closed copy, on a 422 for a decision other than accept', () => {
      updateApplicationStatus.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422 })));
      const toast = toasts();
      const confirm = confirmSpy();

      confirmAction('app_1', 'decline', confirm);

      expect(detailOf(toast)).toBe("The change couldn't be saved. Please try again.");
    });

    it('keeps a confirmed write alive when the tab is destroyed, toasting it and refreshing the counts without reloading', () => {
      const pending = new Subject<void>();
      // Torn down before the answer arrives means the request was cancelled.
      let answered = false;
      let cancelled = false;
      updateApplicationStatus.mockReturnValue(
        new Observable<void>((subscriber) => {
          const subscription = pending.subscribe(subscriber);
          return () => {
            cancelled = !answered;
            subscription.unsubscribe();
          };
        })
      );
      const toast = toasts();
      const confirm = confirmSpy();
      const emitted = vi.fn();
      fixture.componentRef.setInput('countsRefresh', emitted);

      confirmAction('app_1', 'decline', confirm);
      const reads = getProgramMentees.mock.calls.length;
      fixture.destroy();
      answered = true;
      pending.next();
      pending.complete();

      expect(cancelled).toBe(false);
      expect(detailOf(toast)).toBe('Application declined');
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(getProgramMentees.mock.calls.length).toBe(reads);
    });

    it('offers only the open terms and does nothing when the term dialog is dismissed', () => {
      const confirm = confirmSpy();

      fixture.componentInstance['onDeclineByTerm']();

      const data = dialogOpen.mock.calls[0][1].data as { terms: MentorshipAdminTermOption[] };
      expect(data.terms.map((item) => item.name)).toEqual(['Fall 2026', 'Winter 2027']);
      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
