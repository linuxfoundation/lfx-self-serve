// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MentorshipMentorProgramDetail, MentorshipMentorTaskCreateRequest, MentorshipMentorTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
import { MentorNoteSaveService } from '../../services/mentor-note-save.service';
import { MentorTaskCreateService } from '../../services/mentor-task-create.service';
import { MentorshipTaskDialogService } from '../../services/mentorship-task-dialog.service';
import { MentorProgramDetailComponent } from './mentor-program-detail.component';

describe('MentorProgramDetailComponent', () => {
  const detail = (): MentorshipMentorProgramDetail => ({
    program: {
      id: 'mp_gridflow_fall26',
      slug: 'gridflow-time-series-ingestion-pipeline',
      name: 'GridFlow: Ingestion Pipeline',
      projectName: 'LF Energy',
      term: 'Fall 2026',
      termStatus: 'active-term',
      stats: { mentees: 2, applicants: 1, tasksToReview: 3 },
      termStartDate: '2026-09-01',
      termEndDate: '2026-12-15',
    },
    mentees: [
      {
        id: 'mnt_1',
        name: 'Alex Rivera',
        email: 'alex.rivera@example.com',
        status: 'accepted',
        termName: 'Fall 2026',
      },
    ],
    applicants: [
      {
        id: 'app_1',
        name: 'Ifeoma Adeyemi',
        email: 'ifeoma.adeyemi@example.com',
        status: 'pending',
        termName: 'Fall 2026',
        createdOn: '2026-06-28',
        updatedOn: '2026-07-02',
      },
    ],
    tabCounts: { tasks: 3, mentees: 1, applicants: 1 },
  });

  let fixture: ComponentFixture<MentorProgramDetailComponent>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let getMentorProgram: ReturnType<typeof vi.fn>;
  let saveNote: ReturnType<typeof vi.fn>;
  let createTasks: ReturnType<typeof vi.fn<(request: MentorshipMentorTaskCreateRequest) => Observable<MentorshipMentorTaskCreateResponse | null>>>;

  /**
   * Takes the dialog `onClose` observable (not the value) — a dismissed dialog emits
   * `undefined`, and passing a default would silently overwrite it. `null` stands for
   * `DialogService.open` refusing to open a dialog.
   */
  const buildWith = (
    onClose: Observable<string | undefined> | null,
    program$: Observable<MentorshipMentorProgramDetail> = of(detail()),
    save$: Observable<boolean> = of(true)
  ): void => {
    dialogOpen = vi.fn(() => (onClose ? { onClose } : null));
    getMentorProgram = vi.fn(() => program$);
    saveNote = vi.fn(() => save$);
    createTasks = vi.fn(() => of<MentorshipMentorTaskCreateResponse | null>({ created: ['mnt_1'], failed: [] }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramDetailComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: DialogService, useValue: { open: dialogOpen } },
        {
          provide: MentorshipTaskDialogService,
          useValue: { openCreate: vi.fn().mockReturnValue(EMPTY), openCreateGroup: vi.fn().mockReturnValue(EMPTY), openEdit: vi.fn().mockReturnValue(EMPTY) },
        },
        { provide: MentorshipMentorService, useValue: { getMentorProgram } },
        { provide: MentorNoteSaveService, useValue: { save: saveNote } },
        { provide: MentorTaskCreateService, useValue: { create: createTasks } },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['programId', 'mp_gridflow_fall26']]) as never) } },
      ],
    });

    fixture = TestBed.createComponent(MentorProgramDetailComponent);
    fixture.detectChanges();
  };

  const build = (): void => buildWith(of('a saved note'));
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the detail once the service resolves', () => {
    build();

    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-header"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-title"]')?.textContent?.trim()).toBe('GridFlow: Ingestion Pipeline');
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-loading"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-error-state"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-not-found"]')).toBeNull();
  });

  it('renders the generic error state with a Retry CTA on a non-404 failure', () => {
    buildWith(
      of(undefined),
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Server error' }))
    );

    const error = element().querySelector('[data-testid="mentorship-mentor-program-detail-error-state"]');
    expect(error).not.toBeNull();
    // The generic error path must not fall through to the 404 empty state.
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-not-found"]')).toBeNull();
  });

  it('renders the "Program not found" empty state on a 404, hiding the generic Retry CTA', () => {
    // A 404 is not retryable — retrying just 404s again. The dedicated empty state gives
    // the user a working back-to-programs CTA instead of a broken Retry loop.
    buildWith(
      of(undefined),
      throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not Found' }))
    );

    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-not-found"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-error-state"]')).toBeNull();
  });

  it('renders the "Program not found" empty state on a 400 for an id that is not a program id', () => {
    // An old slug URL is refused with the BFF's own 400, which retrying cannot fix either.
    buildWith(
      of(undefined),
      throwError(() => new HttpErrorResponse({ status: 400, statusText: 'Bad Request', error: { code: 'VALIDATION_ERROR' } }))
    );

    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-not-found"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-error-state"]')).toBeNull();
  });

  it('keeps the Retry CTA on a 400 relayed from upstream', () => {
    // Only the BFF's own validation means the id is wrong; an upstream 400 is a failed read.
    buildWith(
      of(undefined),
      throwError(() => new HttpErrorResponse({ status: 400, statusText: 'Bad Request', error: { code: 'BAD_REQUEST' } }))
    );

    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-error-state"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-not-found"]')).toBeNull();
  });

  it('re-invokes the service when Retry is triggered', () => {
    build();

    expect(getMentorProgram).toHaveBeenCalledTimes(1);

    fixture.componentInstance['retry']();
    fixture.detectChanges();

    expect(getMentorProgram).toHaveBeenCalledTimes(2);
  });

  it('switches the active tab when the header emits a change', () => {
    build();

    expect(fixture.componentInstance['activeTab']()).toBe('tasks');
    expect(element().querySelector('[data-testid="mentorship-mentor-tasks-tab"]')).not.toBeNull();

    fixture.componentInstance['onTabChange']('mentees');
    fixture.detectChanges();

    expect(fixture.componentInstance['activeTab']()).toBe('mentees');
    expect(element().querySelector('[data-testid="mentorship-mentor-mentees-tab"]')).not.toBeNull();
  });

  /** An accepted mentee is listed on both tabs under its application id. */
  const withAcceptedApplicant = (note?: string): MentorshipMentorProgramDetail => {
    const value = detail();
    value.mentees = [{ ...value.mentees[0], note }];
    value.applicants = [...value.applicants, { ...value.applicants[0], id: 'mnt_1', name: 'Alex Rivera', status: 'accepted', note }];
    return value;
  };
  const shownDetail = (): MentorshipMentorProgramDetail | null => fixture.componentInstance['detail']();
  const requestNote = (personId = 'app_1', personName = 'Ifeoma Adeyemi'): void => fixture.componentInstance['onNoteRequested']({ personId, personName });

  it('saves a changed note and writes it into the row on both tabs', () => {
    buildWith(of('a saved note'), of(withAcceptedApplicant()));

    requestNote('mnt_1', 'Alex Rivera');

    expect(saveNote).toHaveBeenCalledWith('mnt_1', 'a saved note');
    expect(shownDetail()?.mentees[0].note).toBe('a saved note');
    expect(shownDetail()?.applicants.find((applicant) => applicant.id === 'mnt_1')?.note).toBe('a saved note');
    expect(shownDetail()?.applicants.find((applicant) => applicant.id === 'app_1')?.note).toBeUndefined();
  });

  it('clears the row note when an empty note is saved', () => {
    buildWith(of(''), of(withAcceptedApplicant('from the server')));

    requestNote('mnt_1', 'Alex Rivera');

    expect(saveNote).toHaveBeenCalledWith('mnt_1', '');
    expect(shownDetail()?.mentees[0].note).toBeUndefined();
    expect(shownDetail()?.applicants.find((applicant) => applicant.id === 'mnt_1')?.note).toBeUndefined();
  });

  it('keeps the row note when the save fails', () => {
    buildWith(of('a new note'), of(withAcceptedApplicant('from the server')), of(false));

    requestNote('mnt_1', 'Alex Rivera');

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(shownDetail()?.mentees[0].note).toBe('from the server');
  });

  it('skips the save when the note dialog is dismissed', () => {
    // Dismissal resolves to `undefined` — that must be treated as "no change", not as a
    // defaulted empty string that clears the note.
    buildWith(of(undefined));

    requestNote();

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('skips the save when the note is unchanged', () => {
    buildWith(of('from the server'), of(withAcceptedApplicant('from the server')));

    requestNote('mnt_1', 'Alex Rivera');

    expect(saveNote).not.toHaveBeenCalled();
  });

  it('skips the save when the stored note differs only by surrounding whitespace', () => {
    buildWith(of('from the server'), of(withAcceptedApplicant('  from the server ')));

    requestNote('mnt_1', 'Alex Rivera');

    expect(saveNote).not.toHaveBeenCalled();
  });

  it('keeps the dialog shut for a row whose save is in flight', () => {
    const save$ = new Subject<boolean>();
    buildWith(of('a saved note'), of(detail()), save$);

    requestNote();
    requestNote();
    expect(dialogOpen).toHaveBeenCalledTimes(1);

    save$.next(true);
    save$.complete();
    requestNote();
    expect(dialogOpen).toHaveBeenCalledTimes(2);
  });

  it('seeds the dialog with the row note, then with the note saved since', () => {
    const value = detail();
    value.applicants = [{ ...value.applicants[0], note: 'from the server' }];
    buildWith(of('a saved note'), of(value));

    requestNote();
    expect(dialogOpen).toHaveBeenLastCalledWith(
      MenteeNoteDialogComponent,
      expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'from the server' } })
    );

    requestNote();
    expect(dialogOpen).toHaveBeenLastCalledWith(
      MenteeNoteDialogComponent,
      expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'a saved note' } })
    );
  });

  it('survives DialogService.open returning null', () => {
    // PrimeNG returns null when a dialog of the same component is still registered,
    // which a rapid double-click on two rows can trigger.
    buildWith(null);

    expect(() => requestNote()).not.toThrow();
    expect(saveNote).not.toHaveBeenCalled();
  });

  describe('task create', () => {
    const request: MentorshipMentorTaskCreateRequest = { applicationIds: ['mnt_1'], name: 'Write a design doc', description: 'One page.' };
    const withNewTask = (): MentorshipMentorProgramDetail => {
      const value = detail();
      value.mentees = [{ ...value.mentees[0], tasksTotal: 1 }];
      return value;
    };

    it('creates the tasks, then re-reads the detail without the loading state', () => {
      build();
      getMentorProgram.mockReturnValueOnce(of(withNewTask()));

      fixture.componentInstance['onTaskCreateRequested'](request);
      fixture.detectChanges();

      expect(createTasks).toHaveBeenCalledWith(request);
      expect(getMentorProgram).toHaveBeenCalledTimes(2);
      expect(getMentorProgram).toHaveBeenLastCalledWith('mp_gridflow_fall26');
      expect(shownDetail()?.mentees[0].tasksTotal).toBe(1);
      expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-loading"]')).toBeNull();
    });

    it.each([
      ['no task was created', { created: [], failed: ['mnt_1'] }],
      ['the create failed', null],
    ])('skips the re-read when %s', (_label, result) => {
      build();
      createTasks.mockReturnValueOnce(of(result));

      fixture.componentInstance['onTaskCreateRequested'](request);

      expect(getMentorProgram).toHaveBeenCalledTimes(1);
    });

    it('keeps the rows on screen when the re-read fails', () => {
      build();
      getMentorProgram.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));

      fixture.componentInstance['onTaskCreateRequested'](request);
      fixture.detectChanges();

      expect(shownDetail()?.mentees[0].id).toBe('mnt_1');
      expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-error-state"]')).toBeNull();
    });
  });
});
