// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE } from '@lfx-one/shared/constants';
import { MentorshipAdminMenteesResponse, MentorshipAdminProgramPage, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  const programPage = (): MentorshipAdminProgramPage => ({
    program: {
      id: 'mp_example_fall26',
      slug: 'example-program',
      name: 'Example Program',
      projectName: 'Example Foundation',
      term: 'Fall 2026',
      status: 'open',
      stats: { mentors: 2, mentees: 1, graduated: 0 },
      createdOn: '2026-05-01',
      updatedOn: '2026-07-02',
    },
    tabCounts: { currentMentees: 2, pastMentees: null, mentors: 0, terms: 1 },
    terms: [{ id: 'trm_fall26', name: 'Fall 2026', status: 'open' }],
  });

  const menteesPage = (): MentorshipAdminMenteesResponse => ({
    data: [application(), application({ id: 'app_2', name: 'Alex Rivera', email: 'alex.rivera@example.com', status: 'accepted' })],
    total: 2,
  });

  let fixture: ComponentFixture<ProgramDetailComponent>;
  let getProgram: ReturnType<typeof vi.fn<(programId: string) => Observable<MentorshipAdminProgramPage>>>;
  let getProgramMentees: ReturnType<typeof vi.fn>;

  const buildWith = (options: { page?: Observable<MentorshipAdminProgramPage> } = {}): void => {
    getProgram = vi.fn().mockReturnValue(options.page ?? of(programPage()));
    getProgramMentees = vi.fn().mockReturnValue(of(menteesPage()));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: MentorshipAdminService,
          useValue: {
            getProgram,
            getProgramMentees,
            getProgramMentors: vi.fn().mockReturnValue(of({ data: [], total: 0 })),
            getProgramTerms: vi.fn().mockReturnValue(of({ data: [], total: 0 })),
            getApplicationTasks: vi.fn().mockReturnValue(of([])),
          },
        },
        {
          provide: MentorshipService,
          // The Mentors tab loads its invite picker on construction, and the counts refresh test renders that tab.
          useValue: { getInvitableUsers: () => of(EMPTY_MENTORSHIP_INVITABLE_USERS_RESPONSE) },
        },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['programId', 'mp_example_fall26']]) as never) } },
      ],
    });

    fixture = TestBed.createComponent(ProgramDetailComponent);
    settle();
  };

  /** Runs the effects that start the reads, then renders what they wrote. */
  const settle = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  const build = (): void => buildWith();

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const showTab = (tab: string): void => {
    fixture.componentInstance['activeTab'].set(tab as never);
    settle();
  };
  const tabText = (value: string): string =>
    (element().querySelector(`[data-testid="mentorship-program-detail-tab-${value}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  describe('with a program page', () => {
    beforeEach(() => build());

    it('reads the page for the program in the route', () => {
      expect(getProgram).toHaveBeenCalledWith('mp_example_fall26');
    });

    it('opens on the Current Mentees tab, handing it the program id and the terms', () => {
      expect(element().querySelector('[data-testid="mentorship-current-mentees-tab"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentorship-past-mentees-tab"]')).toBeNull();
      expect(element().querySelector('[data-testid="mentorship-current-mentee-row-app_1"]')).not.toBeNull();
      expect(getProgramMentees).toHaveBeenCalledWith('mp_example_fall26', expect.objectContaining({ type: 'current' }));
    });

    it('shows the counts the page carries, and a dash for one that could not be read', () => {
      expect(tabText('current-mentees')).toBe('Current Mentees 2');
      expect(tabText('past-mentees')).toBe('Past Mentees –');
      expect(tabText('mentors')).toBe('Mentors 0');
      expect(tabText('terms')).toBe('Terms 1');
    });

    it('shows the Past Mentees tab without the current tab’s write affordances', () => {
      showTab('past-mentees');

      expect(element().querySelector('[data-testid="mentorship-past-mentees-tab"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentorship-current-mentee-note-app_1"]')).toBeNull();
      expect(element().querySelector('[data-testid="mentorship-current-mentee-actions-app_1"]')).toBeNull();
    });

    it('reads the counts again without the loading state when a decision changes them', () => {
      const refreshed = programPage();
      refreshed.tabCounts = { ...refreshed.tabCounts, currentMentees: 1 };
      getProgram.mockReturnValue(of(refreshed));
      const isLoading = vi.spyOn(fixture.componentInstance['isLoading'], 'set');

      fixture.componentInstance['refreshCounts']();
      settle();

      expect(getProgram).toHaveBeenCalledTimes(2);
      expect(isLoading).not.toHaveBeenCalled();
      expect(tabText('current-mentees')).toBe('Current Mentees 1');
      expect(element().querySelector('[data-testid="mentorship-current-mentees-tab"]')).not.toBeNull();
    });

    it('keeps the counts on screen when reading them again fails', () => {
      getProgram.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      fixture.componentInstance['refreshCounts']();
      settle();

      expect(tabText('current-mentees')).toBe('Current Mentees 2');
      expect(fixture.componentInstance['pageError']()).toBeNull();
    });

    it('hands Current Mentees a refresh that still updates the counts after that tab is destroyed', () => {
      const refreshed = programPage();
      refreshed.tabCounts = { ...refreshed.tabCounts, currentMentees: 1 };
      getProgram.mockReturnValue(of(refreshed));
      const countsRefresh: () => void = fixture.componentInstance['countsRefresh'];

      showTab('mentors');
      countsRefresh();
      settle();

      expect(tabText('current-mentees')).toBe('Current Mentees 1');
    });

    it('drops a refresh that answers after a newer one started', () => {
      const older = new Subject<MentorshipAdminProgramPage>();
      const newer = new Subject<MentorshipAdminProgramPage>();
      getProgram.mockReturnValueOnce(older).mockReturnValueOnce(newer);
      const stale = programPage();
      stale.tabCounts = { ...stale.tabCounts, currentMentees: 5 };
      const fresh = programPage();
      fresh.tabCounts = { ...fresh.tabCounts, currentMentees: 1 };

      fixture.componentInstance['refreshCounts']();
      fixture.componentInstance['refreshCounts']();
      newer.next(fresh);
      newer.complete();
      older.next(stale);
      older.complete();
      settle();

      expect(tabText('current-mentees')).toBe('Current Mentees 1');
    });
  });

  describe('when the page cannot be shown', () => {
    const failWith = (status: number): void => buildWith({ page: throwError(() => new HttpErrorResponse({ status })) });

    it('shows a no-access state for a 403', () => {
      failWith(403);

      expect(element().querySelector('[data-testid="mentorship-admin-program-no-access"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentorship-admin-program-not-found"]')).toBeNull();
      expect(element().querySelector('[data-testid="mentorship-current-mentees-tab"]')).toBeNull();
    });

    it('shows a not-found state for a 404', () => {
      failWith(404);

      expect(element().querySelector('[data-testid="mentorship-admin-program-not-found"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentorship-admin-program-no-access"]')).toBeNull();
    });

    it('shows an inline error with Retry for any other failure, and reads the page again on Retry', () => {
      failWith(503);

      expect(element().querySelector('[data-testid="mentorship-admin-program-load-error"]')).not.toBeNull();
      expect(element().querySelector('[data-testid="mentorship-admin-program-not-found"]')).toBeNull();

      getProgram.mockReturnValue(of(programPage()));
      element().querySelector<HTMLElement>('[data-testid="mentorship-admin-program-retry"]')?.querySelector<HTMLButtonElement>('button')?.click();
      settle();

      expect(getProgram).toHaveBeenCalledTimes(2);
      expect(element().querySelector('[data-testid="mentorship-admin-program-load-error"]')).toBeNull();
      expect(element().querySelector('[data-testid="mentorship-current-mentees-tab"]')).not.toBeNull();
    });
  });
});
