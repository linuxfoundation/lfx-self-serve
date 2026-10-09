// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import {
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
  MENTORSHIP_PROGRAM_HIDDEN_MESSAGE,
  MENTORSHIP_PROGRAM_HIDE_BLOCKED_MESSAGE,
  MENTORSHIP_PROGRAM_UNHIDE_BLOCKED_MESSAGE,
  MENTORSHIP_PROGRAM_VISIBILITY_FAILED_MESSAGE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminMenteesResponse, MentorshipAdminProgramPage, MentorshipProgramApplicant } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MentorshipService } from '@services/mentorship.service';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

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
  let setProgramVisibility: ReturnType<typeof vi.fn>;
  let routeParams: BehaviorSubject<Map<string, string>>;

  const buildWith = (options: { page?: Observable<MentorshipAdminProgramPage>; visibility?: Observable<void> } = {}): void => {
    getProgram = vi.fn().mockReturnValue(options.page ?? of(programPage()));
    setProgramVisibility = vi.fn().mockReturnValue(options.visibility ?? of(undefined));
    getProgramMentees = vi.fn().mockReturnValue(of(menteesPage()));
    routeParams = new BehaviorSubject(new Map([['programId', 'mp_example_fall26']]));

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
            setProgramVisibility,
          },
        },
        // The tab's task writes go through the shared mentorship service; no test here sends one.
        { provide: MentorshipService, useValue: { createTasks: vi.fn(), updateTask: vi.fn() } },
        { provide: ActivatedRoute, useValue: { paramMap: routeParams as never } },
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
    fixture.componentInstance['onTabChange'](tab as never);
    settle();
  };
  const tabText = (value: string): string =>
    (element().querySelector(`[data-testid="mentorship-program-detail-tab-${value}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  describe('with a program page', () => {
    beforeEach(() => build());

    it('reads the page for the program in the route', () => {
      expect(getProgram).toHaveBeenCalledWith('mp_example_fall26');
    });

    it('opens the enroll wizard in edit mode for this program from Edit Program', () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

      element().querySelector<HTMLButtonElement>('[data-testid="mentorship-program-detail-edit"] button')!.click();

      expect(navigate).toHaveBeenCalledWith(['/mentorship/admin/enroll'], { queryParams: { programId: 'mp_example_fall26' } });
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

  describe('with a pending program', () => {
    const pendingPage = (): MentorshipAdminProgramPage => {
      const page = programPage();
      page.program.status = 'pending-review';
      return page;
    };

    beforeEach(() => buildWith({ page: of(pendingPage()) }));

    it('shows the Terms tab only and opens on it, reading no mentees', () => {
      expect(tabText('terms')).toBe('Terms 1');
      expect(element().querySelectorAll('[role="tab"]')).toHaveLength(1);
      expect(element().querySelector('[data-testid="mentorship-current-mentees-tab"]')).toBeNull();
      expect(element().querySelector('[role="tabpanel"]')?.id).toBe('mentorship-program-detail-tab-panel-terms');
      expect(getProgramMentees).not.toHaveBeenCalled();
    });

    it('shows all four tabs once a refresh reads the program as published, staying on Terms', () => {
      getProgram.mockReturnValue(of(programPage()));

      fixture.componentInstance['refreshCounts']();
      settle();

      expect(element().querySelectorAll('[role="tab"]')).toHaveLength(4);
      expect(fixture.componentInstance['activeTab']()).toBe('terms');
    });
  });

  it('opens another program on its own first tab when the route reuses the page', () => {
    buildWith({ page: of({ ...programPage(), program: { ...programPage().program, status: 'pending-review' } }) });
    expect(fixture.componentInstance['activeTab']()).toBe('terms');
    getProgram.mockReturnValue(of({ ...programPage(), program: { ...programPage().program, id: 'mp_other' } }));

    routeParams.next(new Map([['programId', 'mp_other']]));
    settle();

    expect(getProgram).toHaveBeenLastCalledWith('mp_other');
    expect(fixture.componentInstance['activeTab']()).toBe('current-mentees');
    expect(element().querySelector('[data-testid="mentorship-current-mentees-tab"]')).not.toBeNull();
  });

  it('falls back to the first tab when a refresh hides the open one', () => {
    build();
    showTab('mentors');
    const pending = programPage();
    pending.program.status = 'pending-review';
    getProgram.mockReturnValue(of(pending));

    fixture.componentInstance['refreshCounts']();
    settle();

    expect(fixture.componentInstance['activeTab']()).toBe('terms');
    expect(element().querySelector('[data-testid="mentorship-mentors-tab"]')).toBeNull();
  });

  describe('hiding and unhiding the program', () => {
    let addToast: MockInstance<MessageService['add']>;
    const toasts = (): ToastMessageOptions[] => addToast.mock.calls.map(([message]) => message);

    const buildAndSpy = (visibility?: Observable<void>): void => {
      buildWith({ visibility });
      addToast = vi.spyOn(TestBed.inject(MessageService), 'add');
    };

    it('hides the program, shows a toast and reads the header again', () => {
      buildAndSpy();
      fixture.componentInstance['onVisibilityChange']('hide');

      expect(setProgramVisibility).toHaveBeenCalledWith('mp_example_fall26', 'hide');
      expect(toasts()).toEqual([expect.objectContaining({ severity: 'success', detail: MENTORSHIP_PROGRAM_HIDDEN_MESSAGE })]);
      expect(getProgram).toHaveBeenCalledTimes(2);
      expect(fixture.componentInstance['visibilityBusy']()).toBe(false);
    });

    it('lands the change and its toast even when the admin leaves the page first', () => {
      const pending = new Subject<void>();
      buildAndSpy(pending);
      fixture.componentInstance['onVisibilityChange']('hide');
      fixture.destroy();

      expect(pending.observed).toBe(true);
      pending.next();
      pending.complete();

      expect(toasts()).toEqual([expect.objectContaining({ severity: 'success', detail: MENTORSHIP_PROGRAM_HIDDEN_MESSAGE })]);
    });

    it('ignores a second change while one is saving', () => {
      const pending = new Subject<void>();
      buildAndSpy(pending);
      fixture.componentInstance['onVisibilityChange']('hide');
      fixture.componentInstance['onVisibilityChange']('hide');

      expect(setProgramVisibility).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance['visibilityBusy']()).toBe(true);
    });

    it.each([
      ['hide', MENTORSHIP_PROGRAM_HIDE_BLOCKED_MESSAGE],
      ['unhide', MENTORSHIP_PROGRAM_UNHIDE_BLOCKED_MESSAGE],
    ] as const)('explains a refused %s and reads the header again', (action, message) => {
      buildAndSpy(throwError(() => new HttpErrorResponse({ status: 409 })));
      fixture.componentInstance['onVisibilityChange'](action);

      expect(toasts()).toEqual([expect.objectContaining({ severity: 'error', detail: message })]);
      expect(getProgram).toHaveBeenCalledTimes(2);
    });

    it('shows the server text for the impersonation 403', () => {
      buildAndSpy(
        throwError(
          () => new HttpErrorResponse({ status: 403, error: { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE, message: 'Read-only while impersonating' } })
        )
      );
      fixture.componentInstance['onVisibilityChange']('hide');

      expect(toasts()).toEqual([expect.objectContaining({ severity: 'error', detail: 'Read-only while impersonating' })]);
    });

    it('shows a generic failure for a 403 that is not the impersonation one', () => {
      buildAndSpy(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'Forbidden' } })));
      fixture.componentInstance['onVisibilityChange']('hide');

      expect(toasts()).toEqual([expect.objectContaining({ severity: 'error', detail: MENTORSHIP_PROGRAM_VISIBILITY_FAILED_MESSAGE })]);
    });

    it('shows a generic failure for any other error, without reading the header again', () => {
      buildAndSpy(throwError(() => new HttpErrorResponse({ status: 500 })));
      fixture.componentInstance['onVisibilityChange']('unhide');

      expect(toasts()).toEqual([expect.objectContaining({ severity: 'error', detail: MENTORSHIP_PROGRAM_VISIBILITY_FAILED_MESSAGE })]);
      expect(getProgram).toHaveBeenCalledTimes(1);
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
