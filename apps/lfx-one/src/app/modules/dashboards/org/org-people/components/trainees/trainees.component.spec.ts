// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { EMPTY_ORG_TRAINEES_RESPONSE } from '@lfx-one/shared/constants';
import type {
  OrgLensTimeRange,
  OrgTraineeDetailRow,
  OrgTraineeRowVm,
  OrgTraineesResponse,
  OrgTrainingFilterOptions,
  OrgTrainingStats,
  OrgTrainingStatsQuery,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensTrainingService } from '@services/org-lens-training.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { firstValueFrom, Observable, of, Subject, throwError, timer } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { TraineesService } from '../../services/trainees.service';
import { TraineesComponent } from './trainees.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

function detail(personKey: string, courseId: string, status: OrgTraineeDetailRow['status'], overrides: Partial<OrgTraineeDetailRow> = {}): OrgTraineeDetailRow {
  return {
    personKey,
    status,
    courseOrCertId: `${status}:${personKey}:${courseId}`,
    courseId,
    courseName: courseId,
    foundationId: 'foundation-a',
    foundationName: 'foundation-a',
    projectId: null,
    projectName: null,
    courseLevel: null,
    productType: 'Training',
    courseFormat: null,
    activityTs: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

const PEOPLE = [
  { personKey: 'p-1', lfid: null, cdpMemberId: null, name: 'Ada Lovelace', title: 'Engineer', email: 'ada@example.com' },
  { personKey: 'p-2', lfid: null, cdpMemberId: null, name: 'Alan Turing', title: null, email: null },
  { personKey: 'p-3', lfid: null, cdpMemberId: null, name: 'Grace Hopper', title: null, email: null },
];

/**
 * Three people over two projects. Two course ids share the name "Kubernetes Basics"; "Kubernetes Admin" is a certification
 * product; p-1 re-enrolled in the admin course after certifying (one pair, Certified wins). Past 30 days holds the Linux
 * enrollment only.
 */
function responseFor(range: OrgLensTimeRange): OrgTraineesResponse {
  const linux = detail('p-3', 'lfs101', 'Enrolled', { courseName: 'Linux Intro', projectId: 'proj-linux', courseFormat: 'E-Learning' });
  const details =
    range === '30d'
      ? [linux]
      : [
          detail('p-1', 'k8s-a', 'Enrolled', { courseName: 'Kubernetes Basics', projectId: 'proj-k8s', courseLevel: 'Beginner', courseFormat: 'E-Learning' }),
          detail('p-1', 'cka', 'Certified', {
            courseName: 'Kubernetes Admin',
            projectId: 'proj-k8s',
            courseLevel: 'Intermediate',
            productType: 'Certification',
            courseFormat: 'Certification Exam',
          }),
          detail('p-1', 'cka', 'Enrolled', {
            courseName: 'Kubernetes Admin',
            projectId: 'proj-k8s',
            courseLevel: 'Intermediate',
            productType: 'Certification',
            courseFormat: 'Certification Exam',
          }),
          detail('p-2', 'k8s-b', 'Certified', {
            courseName: 'Kubernetes Basics',
            projectId: 'proj-k8s',
            courseLevel: 'Beginner',
            courseFormat: 'Instructor Led',
          }),
          linux,
        ];
  return {
    ...EMPTY_ORG_TRAINEES_RESPONSE,
    accountId: ORG,
    timeRange: range,
    trainees: PEOPLE.filter((person) => details.some((d) => d.personKey === person.personKey)),
    details,
    asOf: '2026-10-30T09:48:21.094Z',
  };
}

function statsFor(query: OrgTrainingStatsQuery): OrgTrainingStats {
  return {
    range: query.range,
    asOf: '2026-10-30T09:48:21.094Z',
    rosterMembers: 40,
    rosterMembersAsOf: '2026-10-30T09:48:21.094Z',
    peopleWithTrainingActivity: 3,
    learnersOutsidePeopleList: 0,
    coursesTaken: 4,
    certifications: 1,
    certifiedPeople: 1,
    trainingsCompleted: 1,
    completionRatePct: 50,
    coursesInProgress: 2,
    peopleInTraining: 2,
  };
}

/** Every value the specs filter on, so the filter bar's pruning of unlisted selections never drops a URL filter under test. */
const FILTER_OPTIONS: OrgTrainingFilterOptions = {
  foundations: [
    { label: 'lf', value: 'lf' },
    { label: 'foundation-a', value: 'foundation-a' },
  ],
  projects: [
    { label: 'proj-k8s', value: 'proj-k8s' },
    { label: 'proj-linux', value: 'proj-linux' },
  ],
  courses: [
    { label: 'Kubernetes Basics', value: 'Kubernetes Basics' },
    { label: 'Kubernetes Admin', value: 'Kubernetes Admin' },
    { label: 'Linux Intro', value: 'Linux Intro' },
    { label: 'lfs101', value: 'lfs101' },
  ],
  levels: [
    { label: 'Beginner', value: 'Beginner' },
    { label: 'Intermediate', value: 'Intermediate' },
  ],
  formats: [
    { label: 'E-Learning', value: 'E-Learning' },
    { label: 'Instructor Led', value: 'Instructor Led' },
    { label: 'Certification Exam', value: 'Certification Exam' },
  ],
};

describe('TraineesComponent', () => {
  let fixture: ComponentFixture<TraineesComponent>;
  let getTrainees: Mock<(orgUid: string, range: OrgLensTimeRange) => Observable<OrgTraineesResponse>>;
  let getTrainingStats: Mock<(orgUid: string, query: OrgTrainingStatsQuery) => Observable<OrgTrainingStats>>;
  let drawerOpen: Mock;
  let account: WritableSignal<{ uid: string; accountName: string }>;

  const el = (): HTMLElement => fixture.nativeElement;
  const router = (): Router => TestBed.inject(Router);
  const outsideToggle = (): HTMLElement | null => el().querySelector('[data-testid="org-people-trainees-outside-toggle"]');
  const outsideNote = (): HTMLElement | null => el().querySelector('[data-testid="org-people-trainees-outside-note"]');
  const stat = (name: string): string => el().querySelector(`[data-testid="org-training-stat-${name}-value"]`)?.textContent?.trim() ?? '';
  const listed = (): string[] =>
    [...el().querySelectorAll<HTMLElement>('tbody tr[role="button"]')].map((tr) => tr.getAttribute('data-testid')!.replace('org-people-trainees-row-', ''));
  const cell = (personKey: string, index: number): string =>
    el().querySelectorAll(`tr[data-testid="org-people-trainees-row-${personKey}"] td`)[index]?.textContent?.trim() ?? '';
  const outsideList = (): HTMLElement | null => el().querySelector('[data-testid="org-people-trainees-outside"]');
  const outsideNames = (): string[] => [...(outsideList()?.querySelectorAll('li') ?? [])].map((li) => li.querySelector('span')?.textContent?.trim() ?? '');
  const filteredNote = (): HTMLElement | null => el().querySelector('[data-testid="org-people-trainees-outside-filtered-note"]');
  const emptyText = (): string => el().querySelector('[data-testid="org-people-trainees-empty"] p')?.textContent?.trim() ?? '';

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(url: string): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TraineesComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AccountContextService, useValue: { selectedAccount: account } },
        { provide: TraineesService, useValue: { getTrainees } },
        { provide: OrgLensTrainingService, useValue: { getTrainingStats, getFilterOptions: vi.fn(() => of(FILTER_OPTIONS)) } },
        { provide: PersonDetailDrawerService, useValue: { open: drawerOpen } },
      ],
    }).compileComponents();
    await router().navigateByUrl(url);
    fixture = TestBed.createComponent(TraineesComponent);
    await settle();
  }

  async function search(value: string): Promise<void> {
    fixture.componentInstance.filterForm.patchValue({ search: value });
    await firstValueFrom(timer(200));
    await settle();
  }

  // The list of learners not on the people list starts collapsed; its toggle opens or closes it.
  async function openOutside(): Promise<void> {
    el().querySelector<HTMLElement>('[data-testid="org-people-trainees-outside-toggle"]')!.click();
    await settle();
  }

  beforeEach(() => {
    getTrainees = vi.fn((_orgUid: string, range: OrgLensTimeRange) => of(responseFor(range)));
    getTrainingStats = vi.fn((_orgUid: string, query: OrgTrainingStatsQuery) => of(statsFor(query)));
    drawerOpen = vi.fn();
    account = signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME });
  });

  describe('range and stats come from the URL', () => {
    it('reads Past 2 years by default and the range another tab left in the URL', async () => {
      await mount('/?tab=training');
      expect(getTrainees).toHaveBeenLastCalledWith(ORG, '730d');
      expect(getTrainingStats).toHaveBeenLastCalledWith(ORG, { range: '730d', foundation: null, project: null, course: null, level: null, format: null });

      TestBed.resetTestingModule();
      await mount('/?tab=training&range=30d');
      expect(getTrainees).toHaveBeenLastCalledWith(ORG, '30d');
    });

    it('asks the stats call for the URL filters and shows its numbers on the shared strip', async () => {
      await mount('/?tab=training&range=all&trainingProject=proj-k8s&level=Beginner');

      expect(getTrainingStats).toHaveBeenLastCalledWith(ORG, {
        range: 'all',
        foundation: null,
        project: 'proj-k8s',
        course: null,
        level: 'Beginner',
        format: null,
      });
      expect(stat('courses-taken')).toBe('4');
      expect(stat('certifications')).toBe('1');
      expect(stat('trainings-completed')).toBe('1');
      expect(stat('courses-in-progress')).toBe('2');
      expect(stat('completion-rate')).toBe('50%');
      expect(el().querySelector('[data-testid="org-training-stat-courses-taken-caption"]')?.textContent).toContain('all time');
    });

    it('shows the people-list tiles first and reveals the other stats on the link', async () => {
      await mount('/?tab=training&range=all');
      const visibleTiles = (): string[] =>
        [...el().querySelectorAll<HTMLElement>('[data-testid^="org-training-stat-"][role="note"]')]
          .filter((node) => !node.classList.contains('hidden'))
          .map((node) => node.getAttribute('data-testid')!);
      const toggle = (): HTMLElement => el().querySelector<HTMLElement>('[data-testid="org-training-stats-toggle"]')!;

      expect(visibleTiles()).toEqual([
        'org-training-stat-people-with-training-activity',
        'org-training-stat-courses-taken',
        'org-training-stat-certified-people',
      ]);
      expect(toggle().textContent).toContain('Show 7 more stats');
      // A hidden tile still carries its number, so opening the strip never changes a value.
      expect(stat('courses-in-progress')).toBe('2');

      toggle().click();
      await settle();
      expect(visibleTiles()).toHaveLength(10);
      expect(toggle().textContent).toContain('Show fewer stats');
    });

    it('refetches the rows and the stats when the range in the URL changes, without another navigation', async () => {
      await mount('/?tab=training');
      const navigate = vi.spyOn(router(), 'navigate');

      await router().navigateByUrl('/?tab=training&range=90d');
      await settle();

      expect(getTrainees).toHaveBeenLastCalledWith(ORG, '90d');
      expect(getTrainingStats).toHaveBeenLastCalledWith(ORG, expect.objectContaining({ range: '90d' }));
      expect(navigate).not.toHaveBeenCalled();
    });

    it('states a failed stats read as an error with Retry (never dashes), logs it, still lists the rows, and retries', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getTrainingStats.mockReturnValue(new Observable((subscriber) => subscriber.error(new Error('down'))));
      await mount('/?tab=training');

      expect(el().querySelector('[data-testid="org-people-trainees-stats-error"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="org-people-trainees-stats"]')).toBeNull();
      expect(error).toHaveBeenCalled();
      expect(listed().sort()).toEqual(['p-1', 'p-2', 'p-3']);

      getTrainingStats.mockImplementation((_orgUid: string, query: OrgTrainingStatsQuery) => of(statsFor(query)));
      const traineeCalls = getTrainees.mock.calls.length;
      (el().querySelector('[data-testid="org-people-trainees-stats-retry"] button') as HTMLElement).click();
      await settle();

      // Retrying the stats re-reads the stats only: the loaded table is neither reloaded nor replaced by a skeleton.
      expect(getTrainees.mock.calls.length).toBe(traineeCalls);
      expect(el().querySelector('[data-testid="org-people-trainees-table-skeleton"]')).toBeNull();
      expect(el().querySelector('[data-testid="org-people-trainees-stats-error"]')).toBeNull();
      expect(stat('courses-taken')).toBe('4');
      error.mockRestore();
    });

    describe('former employees on the people list', () => {
      const note = (): string | null => el().querySelector('[data-testid="org-people-trainees-former-note"]')?.textContent?.trim() ?? null;
      const withFormer = (people: number, pairs: number): void => {
        getTrainees.mockImplementation((_orgUid: string, range: OrgLensTimeRange) => of({ ...responseFor(range), formerOnPeopleList: { people, pairs } }));
      };

      it('states how many former employees count in the cards when there are some', async () => {
        withFormer(2, 5);
        await mount('/?tab=training');

        expect(note()).toBe('2 former employees on the people list also count in these numbers; the table lists current employees only.');
      });

      it('uses the singular for one former employee', async () => {
        withFormer(1, 3);
        await mount('/?tab=training');

        expect(note()).toBe('1 former employee on the people list also counts in these numbers; the table lists current employees only.');
      });

      it('shows no note when there are none', async () => {
        await mount('/?tab=training');

        expect(note()).toBeNull();
      });

      it.each([
        ['foundation', 'foundation=f-1'],
        ['trainingProject', 'trainingProject=proj-k8s'],
        ['course', 'course=Kubernetes%20Basics'],
        ['level', 'level=Beginner'],
        ['format', 'format=E-Learning'],
      ])('hides the unfiltered count while a %s filter narrows the cards', async (_key, filter) => {
        withFormer(2, 5);
        await mount(`/?tab=training&${filter}`);

        expect(note()).toBeNull();
      });

      it('hides the note while a new range or organization is loading, and shows the new count once it arrives', async () => {
        withFormer(2, 5);
        await mount('/?tab=training');
        expect(note()).not.toBeNull();

        const pending = new Subject<OrgTraineesResponse>();
        getTrainees.mockImplementation(() => pending.asObservable());
        await TestBed.inject(Router).navigateByUrl('/?tab=training&range=30d');
        await settle();
        expect(note()).toBeNull();

        pending.next({ ...responseFor('30d'), formerOnPeopleList: { people: 1, pairs: 1 } });
        await settle();
        expect(note()).toContain('1 former employee');
      });

      it('does not crash on a response from before the field existed (rolling deployment)', async () => {
        getTrainees.mockImplementation((_orgUid: string, range: OrgLensTimeRange) => {
          const legacy: Partial<OrgTraineesResponse> = { ...responseFor(range) };
          delete legacy.formerOnPeopleList;
          return of(legacy as OrgTraineesResponse);
        });
        await mount('/?tab=training');

        expect(note()).toBeNull();
        expect(stat('courses-taken')).toBe('4');
      });
    });

    it('keeps a URL filter with no rows in the range applied and shows the zeros the stats call returns, not an error', async () => {
      getTrainingStats.mockImplementation((_orgUid: string, query: OrgTrainingStatsQuery) =>
        of({
          ...statsFor(query),
          peopleWithTrainingActivity: 0,
          coursesTaken: 0,
          certifications: 0,
          certifiedPeople: 0,
          trainingsCompleted: 0,
          completionRatePct: 0,
          coursesInProgress: 0,
          peopleInTraining: 0,
        })
      );
      await mount('/?tab=training&range=30d&foundation=no-rows-in-range');

      expect(getTrainingStats).toHaveBeenLastCalledWith(ORG, expect.objectContaining({ range: '30d', foundation: 'no-rows-in-range' }));
      expect(el().querySelector('[data-testid="org-people-trainees-stats-error"]')).toBeNull();
      for (const name of ['courses-taken', 'certifications', 'certified-people', 'trainings-completed', 'courses-in-progress'])
        expect(stat(name), name).toBe('0');
    });

    it('still shows the error state when the stats call fails with HTTP 400', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      getTrainingStats.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, statusText: 'Bad Request' })));
      await mount('/?tab=training&range=30d&foundation=no-rows-in-range');

      expect(el().querySelector('[data-testid="org-people-trainees-stats-error"]')).not.toBeNull();
      error.mockRestore();
    });

    it('leaves the cards alone while the name search narrows the table', async () => {
      await mount('/?tab=training&range=all');
      const calls = getTrainingStats.mock.calls.length;

      await search('ada');

      expect(listed()).toEqual(['p-1']);
      expect(getTrainingStats.mock.calls.length).toBe(calls);
      expect(stat('courses-taken')).toBe('4');
    });
  });

  describe('rows filtered client-side by the URL filters', () => {
    it('lists everyone before a pick', async () => {
      await mount('/?tab=training&range=all');
      expect(listed().sort()).toEqual(['p-1', 'p-2', 'p-3']);
    });

    it.each([
      ['project', 'trainingProject=proj-linux', ['p-3']],
      ['project', 'trainingProject=proj-k8s', ['p-1', 'p-2']],
      ['level', 'level=Intermediate', ['p-1']],
      ['format (certified rows carry one)', 'format=Certification%20Exam', ['p-1']],
      ['format', 'format=Instructor%20Led', ['p-2']],
      ['course name shared by two course ids', 'course=Kubernetes%20Basics', ['p-1', 'p-2']],
      ['project and level together', 'trainingProject=proj-k8s&level=Beginner', ['p-1', 'p-2']],
    ])('narrows the table by %s', async (_label, query, people) => {
      await mount(`/?tab=training&range=all&${query}`);
      expect(listed().sort()).toEqual(people);
    });

    it('counts each person-course pair once per person, split by status and product', async () => {
      await mount('/?tab=training&range=all');

      // columns: chevron, name, status, courses, certs, trainings, in progress, recent
      expect([3, 4, 5, 6].map((i) => cell('p-1', i))).toEqual(['2', '1', '—', '1']);
      expect([3, 4, 5, 6].map((i) => cell('p-2', i))).toEqual(['1', '—', '1', '—']);
      expect(cell('p-1', 2)).toBe('Certified');
      expect(cell('p-3', 2)).toBe('Enrolled');
    });

    it('types the expanded sub-rows by product and collapses re-enrollments to one row per course', async () => {
      await mount('/?tab=training&range=all');
      el().querySelector<HTMLElement>('[data-testid="org-people-trainees-row-p-1"]')!.click();
      await settle();

      const rows = [...el().querySelectorAll('[data-testid="org-people-trainees-row-p-1-detail-row"] tbody tr')].map((tr) =>
        tr.textContent?.replace(/\s+/g, ' ').trim()
      );
      expect(rows).toHaveLength(2);
      expect(rows.some((text) => text?.includes('Kubernetes Admin') && text.includes('Certification'))).toBe(true);
      expect(rows.some((text) => text?.includes('Kubernetes Basics') && text.includes('Training'))).toBe(true);
    });
  });

  describe('course names resolved over the pair', () => {
    const respond = (details: OrgTraineeDetailRow[]) =>
      getTrainees.mockReturnValue(of({ ...EMPTY_ORG_TRAINEES_RESPONSE, accountId: ORG, timeRange: '730d', trainees: [PEOPLE[0]], details, asOf: null }));
    const recent = (): string => cell('p-1', 7);

    it('names the Most Recent Course and its foundation from the resolved pair, not from the latest raw row', async () => {
      respond([
        detail('p-1', 'c-1', 'Enrolled', {
          courseName: 'Alpha Name',
          foundationId: 'f-1',
          foundationName: 'Old Foundation',
          activityTs: '2026-01-01T00:00:00.000Z',
        }),
        detail('p-1', 'c-1', 'Certified', {
          courseName: 'Zulu Name',
          foundationId: 'f-2',
          foundationName: 'New Foundation',
          activityTs: '2026-09-01T00:00:00.000Z',
        }),
      ]);
      await mount('/?tab=training');

      expect(recent()).toContain('Zulu Name');
      expect(recent()).toContain('New Foundation');
      expect(recent()).not.toContain('Alpha Name');
    });

    it('lets a real name beat a row without one, so the course filter matches what the stats count', async () => {
      respond([detail('p-1', 'c-1', 'Enrolled', { courseName: null }), detail('p-1', 'c-1', 'Certified', { courseName: 'Real Name' })]);
      await mount('/?tab=training&course=Real%20Name');

      expect(listed()).toEqual(['p-1']);
      expect(recent()).toContain('Real Name');
    });

    it('falls back to the course id only when no row of the pair has a name, and never matches a course filter then', async () => {
      respond([detail('p-1', 'c-orphan', 'Enrolled', { courseName: null })]);
      await mount('/?tab=training');
      expect(recent()).toContain('c-orphan');

      TestBed.resetTestingModule();
      respond([detail('p-1', 'c-orphan', 'Enrolled', { courseName: null })]);
      await mount('/?tab=training&course=c-orphan');
      expect(listed()).toEqual([]);
    });
  });

  describe('person drawer', () => {
    it('opens for the range the tab lists the person in', async () => {
      await mount('/?tab=trainees&range=30d');
      const row: OrgTraineeRowVm = {
        personKey: 'p-1',
        name: 'Ada Lovelace',
        title: null,
        email: null,
        initials: 'AL',
        avatarColorClass: '',
        status: 'Enrolled',
        coursesCount: 1,
        certsCount: 0,
        trainingsCompletedCount: 0,
        inProgressCount: 1,
        recentCourseName: null,
        recentFoundationName: null,
      };

      fixture.componentInstance.onPersonClick(row, new Event('click'));

      expect(drawerOpen).toHaveBeenCalledOnce();
      expect(drawerOpen).toHaveBeenCalledWith(expect.objectContaining({ personKey: 'p-1', defaultTab: 'training', range: '30d' }));
    });
  });

  describe('empty states', () => {
    it('reads the picked range for the empty state, and never as a filter', async () => {
      getTrainees.mockImplementation((_org, range) => of({ ...EMPTY_ORG_TRAINEES_RESPONSE, accountId: ORG, timeRange: range }));
      await mount('/?tab=trainees');
      expect(fixture.componentInstance.emptyState()).toBe('none');

      await router().navigateByUrl('/?tab=trainees&range=30d');
      await settle();
      expect(fixture.componentInstance.emptyState()).toBe('range');

      await router().navigateByUrl('/?tab=trainees&range=30d&level=Beginner');
      await settle();
      expect(fixture.componentInstance.emptyState()).toBe('filters');
    });
  });

  // lfx-self-serve#4287
  describe('learners outside the people list', () => {
    beforeEach(() => {
      getTrainees.mockImplementation((_org, range) =>
        of({
          ...responseFor(range),
          trainees: [PEOPLE[0]],
          details: [detail('p-1', 'lfs101', 'Enrolled', { foundationId: 'lf' })],
          // Name and one status each, nothing else; sent unsorted so the list's own order shows.
          outsideLearners: [
            { personKey: 'outside:1', name: 'Zoe Outside', status: 'Certified' },
            { personKey: 'outside:2', name: null, status: 'Enrolled' },
            { personKey: 'outside:3', name: 'Bea Outside', status: 'Enrolled' },
          ],
        })
      );
    });

    it('keeps them collapsed behind a header with the count, and opens the list with its review note on click', async () => {
      await mount('/?tab=training');

      expect(listed()).toEqual(['p-1']);
      expect(outsideList()?.querySelector('h3')?.textContent).toContain('Learners not on the people list (3)');
      expect(outsideToggle()?.getAttribute('aria-expanded')).toBe('false');
      expect(outsideNames()).toEqual([]);
      expect(outsideNote()).toBeNull();
      expect(outsideList()!.querySelector('[data-testid="org-people-trainees-outside-paginator"]')).toBeNull();

      await openOutside();
      expect(outsideToggle()?.getAttribute('aria-expanded')).toBe('true');
      expect(outsideNote()?.textContent).toContain('not on its people list');
      expect(outsideNote()?.textContent).toContain('can appear more than once');
      expect(outsideNote()?.textContent).toContain('org admin');
      expect(outsideNames()).toEqual(['Bea Outside', 'Zoe Outside', 'Name not available']);

      await openOutside();
      expect(outsideToggle()?.getAttribute('aria-expanded')).toBe('false');
      expect(outsideNames()).toEqual([]);
      expect(outsideNote()).toBeNull();
    });

    it('lists them apart from the table, by name, with a name and a status and nothing to expand', async () => {
      await mount('/?tab=training');
      await openOutside();

      expect(listed()).toEqual(['p-1']);
      expect(outsideNames()).toEqual(['Bea Outside', 'Zoe Outside', 'Name not available']);
      const items = [...outsideList()!.querySelectorAll('li')].map((li) => li.textContent ?? '');
      expect(items[1]).toContain('Certified');
      expect(items[0]).toContain('Enrolled');
      expect(outsideList()!.querySelector('ul')!.querySelector('button, [role="button"], [aria-expanded]')).toBeNull();
      expect(filteredNote()).toBeNull();
    });

    it.each([['foundation=lf'], ['course=lfs101'], ['format=E-Learning']])('hides them while %s is in the URL and says why', async (query) => {
      await mount(`/?tab=training&${query}`);

      expect(outsideList()).toBeNull();
      expect(filteredNote()?.textContent).toContain('follow the time range and the name search');
    });

    it('narrows them by the name search, in the header count and in the open list', async () => {
      await mount('/?tab=training');
      await search('bea');

      expect(listed()).toEqual([]);
      expect(outsideList()?.querySelector('h3')?.textContent).toContain('(1)');
      await openOutside();
      expect(outsideNames()).toEqual(['Bea Outside']);
      expect(emptyText()).toBe('No one on the people list matches the search.');
    });

    it('keeps the generic filter copy for a search nobody matches, and says so plainly in the list', async () => {
      await mount('/?tab=training');
      await search('nobody-matches');
      await openOutside();

      expect(emptyText()).toBe('No trainees match the current filters.');
      expect(el().querySelector('[data-testid="org-people-trainees-outside-empty"]')?.textContent?.trim()).toBe('No one in this list matches the search.');
    });

    it('says nobody on the people list has activity when only outside learners have, on any range', async () => {
      getTrainees.mockImplementation((_org, range) =>
        of({
          ...EMPTY_ORG_TRAINEES_RESPONSE,
          accountId: ORG,
          timeRange: range,
          outsideLearners: [{ personKey: 'outside:1', name: 'Zoe Outside', status: 'Enrolled' }],
        })
      );
      await mount('/?tab=training&range=30d');

      expect(emptyText()).toBe('No one on the people list has training activity in this range.');
    });
  });

  describe('pagination', () => {
    const personKey = (i: number): string => `p-${String(i).padStart(2, '0')}`;
    const manyPeople = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        personKey: personKey(i + 1),
        lfid: null,
        cdpMemberId: null,
        name: `Person ${String(i + 1).padStart(2, '0')}`,
        title: null,
        email: null,
      }));
    const respondWith = (count: number, outside = 0) =>
      getTrainees.mockImplementation((_org, range) =>
        of({
          ...EMPTY_ORG_TRAINEES_RESPONSE,
          accountId: ORG,
          timeRange: range,
          trainees: manyPeople(count),
          // One course each, every other person in a second foundation, so a filter can narrow the list.
          details: manyPeople(count).map((person, i) =>
            detail(person.personKey, `course-${i}`, 'Enrolled', {
              foundationId: i % 2 === 0 ? 'foundation-a' : 'lf',
              foundationName: i % 2 === 0 ? 'foundation-a' : 'lf',
            })
          ),
          outsideLearners: Array.from({ length: outside }, (_, i) => ({
            personKey: `outside:${i + 1}`,
            name: `Learner ${String(i + 1).padStart(2, '0')}`,
            status: 'Enrolled' as const,
          })),
          asOf: null,
        })
      );
    const report = (testid: string): string => el().querySelector(`[data-testid="${testid}"] .p-paginator-current`)?.textContent?.trim() ?? '';
    const tableReport = (): string => report('org-people-trainees-paginator');
    const outsideReport = (): string => report('org-people-trainees-outside-paginator');
    const click = async (selector: string): Promise<void> => {
      el().querySelector<HTMLElement>(selector)!.click();
      await settle();
    };
    const nextTable = (): Promise<void> => click('[data-testid="org-people-trainees-paginator"] .p-paginator-next');
    const nextOutside = (): Promise<void> => click('[data-testid="org-people-trainees-outside-paginator"] .p-paginator-next');
    const outsideCount = (): number => outsideList()?.querySelectorAll('li').length ?? 0;
    // The rows-per-page choice goes through the paginator's real PrimeNG dropdown: open it, then click the option in the overlay.
    const choosePageSize = async (paginatorTestId: string, rows: number): Promise<void> => {
      // PrimeNG's overlay reads matchMedia and scrolls the selected option into view, which the test DOM lacks.
      Element.prototype.scrollIntoView ??= () => undefined;
      window.matchMedia ??= ((query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
        }) as unknown as MediaQueryList) as typeof window.matchMedia;
      const select = el().querySelector<HTMLElement>(`[data-testid="${paginatorTestId}"] p-select`)!;
      select.click();
      await settle();
      const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.trim() === String(rows));
      expect(option, `the ${rows} option`).toBeDefined();
      // The options must render outside the component's overflow-hidden containers, or they get clipped.
      expect(el().contains(option!)).toBe(false);
      option!.click();
      await settle();
    };
    const pickPageSize = (rows: number): Promise<void> => choosePageSize('org-people-trainees-paginator', rows);
    const pickOutsidePageSize = (rows: number): Promise<void> => choosePageSize('org-people-trainees-outside-paginator', rows);

    it('shows the first ten rows and the filtered total, with no Show All', async () => {
      respondWith(25);
      await mount('/?tab=training');

      expect(listed()).toEqual(Array.from({ length: 10 }, (_, i) => personKey(i + 1)));
      expect(tableReport()).toBe('Showing 1 to 10 of 25');
      expect(el().textContent).not.toContain('Show All');
      expect(el().querySelector('[data-testid^="org-people-trainees-show-all"]')).toBeNull();
    });

    it('sorts by courses descending then name, and a page change shows the next rows', async () => {
      respondWith(25);
      await mount('/?tab=training');
      await nextTable();

      expect(listed()).toEqual(Array.from({ length: 10 }, (_, i) => personKey(i + 11)));
      expect(tableReport()).toBe('Showing 11 to 20 of 25');
      await nextTable();
      expect(listed()).toHaveLength(5);
      expect(tableReport()).toBe('Showing 21 to 25 of 25');
    });

    it('states one page of rows with no page-size dropdown and no page buttons', async () => {
      respondWith(8);
      await mount('/?tab=training');

      expect(listed()).toHaveLength(8);
      expect(tableReport()).toBe('Showing 1 to 8 of 8');
      const paginator = el().querySelector('[data-testid="org-people-trainees-paginator"]')!;
      expect(paginator.classList.contains('lfx-paginator-no-rpp')).toBe(true);
      expect(paginator.classList.contains('lfx-paginator-single-page')).toBe(true);
    });

    it('offers 10, 25 and 50 rows per page once there are more than ten rows', async () => {
      respondWith(25);
      await mount('/?tab=training');

      const paginator = el().querySelector('[data-testid="org-people-trainees-paginator"]')!;
      expect(paginator.classList.contains('lfx-paginator-no-rpp')).toBe(false);
      expect(paginator.classList.contains('lfx-paginator-single-page')).toBe(false);
    });

    it('changes the rows per page, back to the first page', async () => {
      respondWith(60);
      await mount('/?tab=training');
      await nextTable();
      await pickPageSize(25);

      expect(listed()).toHaveLength(25);
      expect(tableReport()).toBe('Showing 1 to 25 of 60');
    });

    it('goes back to the first page on a search, keeping the rows per page', async () => {
      respondWith(60);
      await mount('/?tab=training');
      await pickPageSize(25);
      await nextTable();
      expect(tableReport()).toBe('Showing 26 to 50 of 60');

      await search('Person 4');
      expect(tableReport()).toBe('Showing 1 to 10 of 10');
      await search('');
      expect(tableReport()).toBe('Showing 1 to 25 of 60');
    });

    it.each([
      ['foundation', 'foundation=lf', 'Showing 1 to 25 of 30'],
      ['range', 'range=365d', 'Showing 1 to 25 of 60'],
    ])('goes back to the first page when the %s in the URL changes', async (_label, query, expected) => {
      respondWith(60);
      await mount('/?tab=training');
      await pickPageSize(25);
      await nextTable();
      expect(tableReport()).toBe('Showing 26 to 50 of 60');

      await router().navigateByUrl(`/?tab=training&${query}`);
      await settle();
      expect(tableReport()).toBe(expected);
      expect(listed()[0]).toBe(personKey(_label === 'foundation' ? 2 : 1));
    });

    it('goes back to the first page when the sort changes', async () => {
      respondWith(25);
      await mount('/?tab=training');
      await nextTable();
      expect(tableReport()).toBe('Showing 11 to 20 of 25');

      el().querySelector<HTMLElement>('th[aria-sort] button')!.click();
      await settle();
      expect(tableReport()).toBe('Showing 1 to 10 of 25');
      expect(listed()[0]).toBe(personKey(1));
    });

    it('goes back to the first page when the organization changes', async () => {
      respondWith(25);
      await mount('/?tab=training');
      await nextTable();

      account.set({ uid: 'another-org', accountName: 'Another' });
      await settle();
      expect(tableReport()).toBe('Showing 1 to 10 of 25');
    });

    describe('expanded rows', () => {
      const toggle = async (key: string): Promise<void> => click(`[data-testid="org-people-trainees-row-${key}"]`);
      const detailRows = (): number => el().querySelectorAll('[data-testid$="-detail-row"]').length;

      it('keeps a row expanded while it is on the page and drops it when the page changes, leaving no orphaned detail row', async () => {
        respondWith(25);
        await mount('/?tab=training');
        await toggle('p-01');
        expect(detailRows()).toBe(1);

        await nextTable();
        expect(detailRows()).toBe(0);
        await click('[data-testid="org-people-trainees-paginator"] .p-paginator-prev');
        expect(listed()[0]).toBe('p-01');
        expect(el().querySelector('[data-testid="org-people-trainees-row-p-01"]')!.getAttribute('aria-expanded')).toBe('false');
        expect(detailRows()).toBe(0);
      });

      it('keeps the expansion through a sort that leaves the person on the page, and drops it when they leave it', async () => {
        respondWith(25);
        await mount('/?tab=training');
        await toggle('p-02');

        // Name ascending: p-01..p-10 stay on page one.
        el().querySelector<HTMLElement>('th[aria-sort] button')!.click();
        await settle();
        expect(el().querySelector('[data-testid="org-people-trainees-row-p-02"]')!.getAttribute('aria-expanded')).toBe('true');
        expect(detailRows()).toBe(1);

        // Name descending: p-25..p-16 are on page one.
        el().querySelector<HTMLElement>('th[aria-sort] button')!.click();
        await settle();
        expect(listed()[0]).toBe('p-25');
        expect(detailRows()).toBe(0);
      });

      it('still toggles with Enter and Space', async () => {
        respondWith(25);
        await mount('/?tab=training');
        const row = el().querySelector<HTMLElement>('[data-testid="org-people-trainees-row-p-03"]')!;
        row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await settle();
        expect(detailRows()).toBe(1);
        row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        await settle();
        expect(detailRows()).toBe(0);
      });
    });

    describe('learners not on the people list', () => {
      it('pages them on their own, with the heading keeping the full count', async () => {
        respondWith(3, 35);
        await mount('/?tab=training');
        await openOutside();

        expect(outsideList()?.querySelector('h3')?.textContent).toContain('(35)');
        expect(outsideCount()).toBe(10);
        expect(outsideReport()).toBe('Showing 1 to 10 of 35');
        expect(tableReport()).toBe('Showing 1 to 3 of 3');
        expect(el().textContent).not.toContain('Show All');

        await nextOutside();
        expect(outsideNames()[0]).toBe('Learner 11');
        expect(outsideReport()).toBe('Showing 11 to 20 of 35');
        expect(tableReport()).toBe('Showing 1 to 3 of 3');
        expect(outsideList()?.querySelector('h3')?.textContent).toContain('(35)');
      });

      it('changes its own rows per page without touching the table', async () => {
        respondWith(30, 60);
        await mount('/?tab=training');
        await openOutside();
        await pickOutsidePageSize(50);

        expect(outsideCount()).toBe(50);
        expect(outsideReport()).toBe('Showing 1 to 50 of 60');
        expect(tableReport()).toBe('Showing 1 to 10 of 30');
      });

      it('goes back to its first page on a search and on a range change, keeping its rows per page', async () => {
        respondWith(3, 60);
        await mount('/?tab=training');
        await openOutside();
        await pickOutsidePageSize(25);
        await nextOutside();
        expect(outsideReport()).toBe('Showing 26 to 50 of 60');

        await search('Learner 1');
        expect(outsideNames()[0]).toBe('Learner 10');
        expect(outsideReport()).toBe('Showing 1 to 10 of 10');
        await search('');
        expect(outsideReport()).toBe('Showing 1 to 25 of 60');

        await nextOutside();
        await router().navigateByUrl('/?tab=training&range=365d');
        await settle();
        expect(outsideReport()).toBe('Showing 1 to 25 of 60');
      });

      it('goes back to its first page when the organization changes', async () => {
        respondWith(3, 35);
        await mount('/?tab=training');
        await openOutside();
        await nextOutside();

        account.set({ uid: 'another-org', accountName: 'Another' });
        await settle();
        // A new organization starts collapsed again, on its first page.
        expect(outsideNames()).toEqual([]);
        await openOutside();
        expect(outsideReport()).toBe('Showing 1 to 10 of 35');
      });

      it('shows names and statuses only, with no identifier beyond the opaque key', async () => {
        respondWith(3, 12);
        await mount('/?tab=training');
        await openOutside();

        const items = [...outsideList()!.querySelectorAll('li')];
        expect(items.every((li) => /^Learner\d+(Enrolled|Certified)$/.test((li.textContent ?? '').replace(/\s+/g, '')))).toBe(true);
        expect(outsideList()!.querySelector('ul')!.querySelector('[role="button"], [aria-expanded], a, [href]')).toBeNull();
      });
    });
  });

  // People-list rows whose person has no current-employee identity row arrive under an opaque key with no trainee entry: never listed or named.
  describe('people-list rows without an identity row', () => {
    it('keeps them out of the table and out of the page text', async () => {
      getTrainees.mockImplementation((_org, range) =>
        of({
          ...responseFor(range),
          trainees: [PEOPLE[0]],
          details: [detail('p-1', 'lfs101', 'Enrolled'), detail('outside:2', 'cka', 'Certified', { productType: 'Certification' })],
        })
      );
      await mount('/?tab=training');

      expect(listed()).toEqual(['p-1']);
      expect(el().textContent).not.toContain('outside:2');
    });
  });
});
