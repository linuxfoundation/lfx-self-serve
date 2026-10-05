// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipProgramApplicant, MentorshipProgramDetail } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteeNoteDialogComponent } from '../../components/mentee-note-dialog/mentee-note-dialog.component';
import { ProgramDetailComponent } from './program-detail.component';

describe('ProgramDetailComponent', () => {
  const application = (overrides: Partial<MentorshipProgramApplicant> = {}): MentorshipProgramApplicant => ({
    id: 'app_1',
    name: 'Ifeoma Adeyemi',
    email: 'ifeoma.adeyemi@example.com',
    status: 'pending',
    termId: 'trm_fall26',
    termName: 'Fall 2026',
    createdOn: '2026-06-28',
    updatedOn: '2026-07-02',
    ...overrides,
  });

  const detail = (): MentorshipProgramDetail => ({
    program: {
      id: 'mp_gridflow_fall26',
      slug: 'gridflow-time-series-ingestion-pipeline',
      name: 'GridFlow: Time-Series Ingestion Pipeline',
      projectName: 'LF Energy',
      term: 'Fall 2026',
      status: 'open',
      stats: { mentors: 2, mentees: 1, graduated: 0 },
      createdOn: '2026-05-01',
      updatedOn: '2026-07-02',
    },
    currentMentees: [application(), application({ id: 'app_2', name: 'Alex Rivera', email: 'alex.rivera@example.com', status: 'accepted' })],
    pastMentees: [
      application({
        id: 'app_3',
        name: 'Dilan Ferreira',
        email: 'dilan.ferreira@example.com',
        status: 'graduated',
        termId: 'trm_spring26',
        termName: 'Spring 2026',
      }),
    ],
    mentors: [],
    terms: [],
    tabCounts: { currentMentees: 2, pastMentees: 1, mentors: 0, terms: 0 },
  });

  let fixture: ComponentFixture<ProgramDetailComponent>;
  let dialogOpen: ReturnType<typeof vi.fn>;

  // Takes the observable rather than the value: a dismissed dialog closes with `undefined`,
  // and passing that through a defaulted parameter would silently restore the default.
  const buildWith = (onClose: Observable<string | undefined>, program: MentorshipProgramDetail = detail()): void => {
    dialogOpen = vi.fn(() => ({ onClose }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: DialogService, useValue: { open: dialogOpen } },
        { provide: MentorshipAdminService, useValue: { getProgram: () => of(program) } },
        {
          provide: MentorshipService,
          // The Mentors tab loads its invite picker on construction, and the persistence
          // test renders that tab to prove notes survive one being destroyed.
          useValue: { getInvitableUsers: () => of(EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE) },
        },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['programId', 'mp_gridflow_fall26']]) as never) } },
      ],
    });

    fixture = TestBed.createComponent(ProgramDetailComponent);
    fixture.detectChanges();
  };

  const build = (): void => buildWith(of('a saved note'));

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const showTab = (tab: string): void => {
    fixture.componentInstance['activeTab'].set(tab as never);
    fixture.detectChanges();
  };
  const noteText = (id: string): string | undefined => element().querySelector(`[data-testid="mentorship-current-mentee-note-${id}"]`)?.textContent?.trim();
  const clickNote = (id: string): void => {
    element().querySelector<HTMLButtonElement>(`[data-testid="mentorship-current-mentee-note-${id}"]`)?.click();
    fixture.detectChanges();
  };

  beforeEach(() => build());

  it('opens on the Current Mentees tab', () => {
    expect(element().querySelector('[data-testid="mentorship-current-mentees-tab"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-past-mentees-tab"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-current-mentee-row-app_1"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-current-mentee-row-app_3"]')).toBeNull();
  });

  it('shows the closed-term rows on the Past Mentees tab, without the write affordances', () => {
    showTab('past-mentees');

    expect(element().querySelector('[data-testid="mentorship-past-mentee-row-app_3"]')).not.toBeNull();
    expect(element().querySelector('[data-testid="mentorship-past-mentee-row-app_1"]')).toBeNull();
    // Past mentees are history, so none of the current tab's write affordances come with them.
    expect(element().querySelector('[data-testid="mentorship-current-mentee-note-app_3"]')).toBeNull();
    expect(element().querySelector('[data-testid="mentorship-current-mentee-actions-app_3"]')).toBeNull();
  });

  it('keeps a reviewer note when the admin leaves the tab and comes back', () => {
    clickNote('app_1');

    expect(dialogOpen).toHaveBeenCalledTimes(1);
    expect(noteText('app_1')).toBe('a saved note');

    // The tab panel is an `@switch`, so this destroys the tab component outright.
    showTab('mentors');
    showTab('current-mentees');

    expect(noteText('app_1')).toBe('a saved note');
  });

  it('holds notes per person', () => {
    clickNote('app_1');

    expect(noteText('app_2')).toBe('Add note');

    clickNote('app_2');

    expect(fixture.componentInstance['noteDrafts']()).toEqual({ app_1: 'a saved note', app_2: 'a saved note' });
  });

  it('leaves the note untouched when the dialog is dismissed', () => {
    buildWith(of(undefined));

    clickNote('app_1');

    expect(fixture.componentInstance['noteDrafts']()).toEqual({});
    expect(noteText('app_1')).toBe('Add note');
  });

  it('seeds the dialog with the row note, then with the draft once one exists', () => {
    const withNote = detail();
    withNote.currentMentees = [application({ note: 'from the server' })];
    buildWith(of('a saved note'), withNote);

    clickNote('app_1');

    expect(dialogOpen).toHaveBeenLastCalledWith(
      MenteeNoteDialogComponent,
      expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'from the server' } })
    );

    // Reopening the same row must offer the draft, not the note it started with.
    clickNote('app_1');

    expect(dialogOpen).toHaveBeenLastCalledWith(
      MenteeNoteDialogComponent,
      expect.objectContaining({ data: { personName: 'Ifeoma Adeyemi', note: 'a saved note' } })
    );
  });

  it('survives the dialog service declining to open a second dialog', () => {
    // PrimeNG returns null when a dialog of the same component is still registered,
    // which a quick second click on another row can do.
    dialogOpen = vi.fn(() => null);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: DialogService, useValue: { open: dialogOpen } },
        { provide: MentorshipAdminService, useValue: { getProgram: () => of(detail()) } },
        { provide: MentorshipService, useValue: { getInvitableUsers: () => of(EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE) } },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['programId', 'mp_gridflow_fall26']]) as never) } },
      ],
    });

    fixture = TestBed.createComponent(ProgramDetailComponent);
    fixture.detectChanges();

    expect(() => clickNote('app_1')).not.toThrow();

    expect(fixture.componentInstance['noteDrafts']()).toEqual({});
  });
});
