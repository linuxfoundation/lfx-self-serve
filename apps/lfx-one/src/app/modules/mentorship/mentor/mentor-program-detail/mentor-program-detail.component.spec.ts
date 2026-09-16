// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
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

  /**
   * Takes the dialog `onClose` observable (not the value) — a dismissed dialog emits
   * `undefined`, and passing a default would silently overwrite it.
   */
  const buildWith = (onClose: Observable<string | undefined>, program$: Observable<MentorshipMentorProgramDetail> = of(detail())): void => {
    dialogOpen = vi.fn(() => ({ onClose }));
    getMentorProgram = vi.fn(() => program$);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramDetailComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: DialogService, useValue: { open: dialogOpen } },
        { provide: MentorshipService, useValue: { getMentorProgram } },
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

  it('re-invokes the service when Retry is triggered', () => {
    build();

    expect(getMentorProgram).toHaveBeenCalledTimes(1);

    fixture.componentInstance['retry']();
    fixture.detectChanges();

    expect(getMentorProgram).toHaveBeenCalledTimes(2);
  });

  it('switches the active tab when the header emits a change', () => {
    build();

    expect(fixture.componentInstance['activeTab']()).toBe('applicants');

    fixture.componentInstance['onTabChange']('mentees');
    fixture.detectChanges();

    expect(fixture.componentInstance['activeTab']()).toBe('mentees');
    expect(element().querySelector('[data-testid="mentorship-mentor-program-detail-mentees-stub"]')).not.toBeNull();
  });

  it('persists a saved note into the drafts map', () => {
    build();

    fixture.componentInstance['onNoteRequested']({ personId: 'app_1', personName: 'Ifeoma Adeyemi' });

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance['noteDrafts']()).toEqual({ app_1: 'a saved note' });
  });

  it('leaves the drafts map untouched when the note dialog is dismissed', () => {
    // Dismissal resolves to `undefined` — that must be treated as "no change", not as a
    // defaulted empty string that clears the note.
    buildWith(of(undefined));

    fixture.componentInstance['onNoteRequested']({ personId: 'app_1', personName: 'Ifeoma Adeyemi' });

    expect(fixture.componentInstance['noteDrafts']()).toEqual({});
  });

  it('survives DialogService.open returning null', () => {
    // PrimeNG returns null when a dialog of the same component is still registered,
    // which a rapid double-click on two rows can trigger.
    dialogOpen = vi.fn(() => null);
    getMentorProgram = vi.fn(() => of(detail()));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorProgramDetailComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: DialogService, useValue: { open: dialogOpen } },
        { provide: MentorshipService, useValue: { getMentorProgram } },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['programId', 'mp_gridflow_fall26']]) as never) } },
      ],
    });

    fixture = TestBed.createComponent(MentorProgramDetailComponent);
    fixture.detectChanges();

    expect(() => fixture.componentInstance['onNoteRequested']({ personId: 'app_1', personName: 'Ifeoma Adeyemi' })).not.toThrow();
    expect(fixture.componentInstance['noteDrafts']()).toEqual({});
  });

  it('seeds the dialog with the row note first, then with the session draft', () => {
    const withNote = detail();
    withNote.applicants = [{ ...withNote.applicants[0], note: 'from the server' }];
    buildWith(of('a saved note'), of(withNote));

    fixture.componentInstance['onNoteRequested']({ personId: 'app_1', personName: 'Ifeoma Adeyemi' });
    expect(dialogOpen).toHaveBeenLastCalledWith(
      MenteeNoteDialogComponent,
      expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'from the server' } })
    );

    // Reopening the same row must offer the draft, not the note it started with.
    fixture.componentInstance['onNoteRequested']({ personId: 'app_1', personName: 'Ifeoma Adeyemi' });
    expect(dialogOpen).toHaveBeenLastCalledWith(
      MenteeNoteDialogComponent,
      expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'a saved note' } })
    );
  });
});
