// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import {
  DEFAULT_ORG_COMMIT_FILTERS,
  EMPTY_ORG_ALL_EMPLOYEE_STATS,
  ORG_CODE_CONTRIBUTIONS_DEFINITION,
  ORG_COMMITS_DEFINITION,
  ORG_MAIN_BRANCH_COMMITS_DEFINITION,
} from '@lfx-one/shared/constants';
import type {
  OrgAllEmployeeEmploymentFilter,
  OrgAllEmployeeRow,
  OrgAllEmployeesResponse,
  OrgCodeFilterValues,
  OrgCommitFilters,
  OrgLensTimeRange,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Tooltip } from 'primeng/tooltip';
import { Observable, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { AllEmployeesService } from '../../services/all-employees.service';
import { AllEmployeesComponent } from './all-employees.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;
const OTHER_ORG = 'other-org-account-id';
const FILTERS: OrgCommitFilters = DEFAULT_ORG_COMMIT_FILTERS;

function row(personKey: string, name: string, over: Partial<OrgAllEmployeeRow> = {}): OrgAllEmployeeRow {
  return {
    personKey,
    lfid: null,
    lfUsername: null,
    cdpMemberId: null,
    name,
    firstName: null,
    lastName: null,
    title: null,
    email: null,
    avatarUrl: null,
    sources: ['snowflake'],
    seatsCount: 0,
    boardSeatsCount: 0,
    committeeSeatsCount: 0,
    commitsCount: 0,
    // Any picked code count is also a code activity unless a test says otherwise.
    codeActivitiesCount: over.commitsCount ?? 0,
    eventsCount: 0,
    coursesCount: 0,
    engagedFoundationIds: [],
    ...over,
  };
}

function response(rows: OrgAllEmployeeRow[], activeInOss: number, accountId: string = ORG): OrgAllEmployeesResponse {
  return { accountId, rows, stats: { ...EMPTY_ORG_ALL_EMPLOYEE_STATS, activeInOss }, foundations: [] };
}

describe('AllEmployeesComponent — Snowflake and live merge in parallel', () => {
  let snowflake$: Subject<OrgAllEmployeesResponse>;
  let live$: Subject<OrgAllEmployeesResponse>;
  let fixture: ComponentFixture<AllEmployeesComponent>;
  let getDirectory: Mock<(orgUid: string, range: OrgLensTimeRange, filters: OrgCommitFilters) => Observable<OrgAllEmployeesResponse>>;
  let getAllEmployees: Mock<(orgUid: string, range: OrgLensTimeRange, filters: OrgCommitFilters) => Subject<OrgAllEmployeesResponse>>;
  let former$: Subject<OrgAllEmployeesResponse>;
  let getFormerEmployees: Mock<(orgUid: string, range: OrgLensTimeRange, filters: OrgCommitFilters) => Observable<OrgAllEmployeesResponse>>;
  let selectedAccount: WritableSignal<{ uid: string; accountName: string }>;

  const el = (): HTMLElement => fixture.nativeElement;
  const rowKeys = (): string[] =>
    [...el().querySelectorAll<HTMLElement>('[data-testid^="org-people-all-employees-row-"]')]
      .map((r) => r.dataset['testid'] ?? '')
      .filter((id) => !id.endsWith('-name') && !id.endsWith('-detail-row') && !id.endsWith('-former'));
  const formerTags = (): string[] => [...el().querySelectorAll<HTMLElement>('[data-testid$="-former"]')].map((tag) => tag.dataset['testid'] ?? '');
  const activeStat = (): string => el().querySelector('[data-testid="org-people-all-employees-stat-active"]')?.textContent ?? '';

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function mount(platformId: 'browser' | 'server', initialUrl = '/'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AllEmployeesComponent],
      providers: [
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: AccountContextService, useValue: { selectedAccount } },
        { provide: AllEmployeesService, useValue: { getAllEmployees, getFormerEmployees, getEmployeeDetail: vi.fn() } },
        { provide: OrgPeopleDirectoryStateService, useValue: { getDirectory, invalidate: vi.fn() } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await TestBed.inject(Router).navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(AllEmployeesComponent);
    await settle();
  }

  beforeEach(() => {
    snowflake$ = new Subject();
    live$ = new Subject();
    getDirectory = vi.fn(() => live$);
    getAllEmployees = vi.fn(() => snowflake$);
    former$ = new Subject();
    getFormerEmployees = vi.fn(() => former$);
    selectedAccount = signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME });
    // Failure paths log before falling back; keep the expected noise out of the test output.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('on the server', () => {
    beforeEach(async () => {
      await mount('server');
    });

    // Not observed holding SSR in prod, but the cause is not established, so the server render starts
    // no read; the browser starts them after hydration.
    it('requests neither the Snowflake roster, the live merge nor the former roster, and keeps the skeleton', () => {
      expect(getAllEmployees).not.toHaveBeenCalled();
      expect(getDirectory).not.toHaveBeenCalled();
      expect(getFormerEmployees).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();
    });
  });

  describe('in the browser', () => {
    beforeEach(async () => {
      // These cases are about the current roster; the former roster answers empty at once.
      getFormerEmployees.mockImplementation(() => of(response([], 0)));
      await mount('browser');
    });

    it('requests the live merge without waiting for the Snowflake roster', () => {
      expect(getDirectory).toHaveBeenCalledWith(ORG, '365d', FILTERS);
      expect(live$.observed).toBe(true);
    });

    it('renders the Snowflake roster and stats while the live merge is still pending', async () => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace', { commitsCount: 1 })], 1));
      snowflake$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
      expect(activeStat()).toContain('1');
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).toBeNull();
    });

    it('replaces the Snowflake rows with a live merge that carries the stored roster, without duplicating anyone', async () => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace', { commitsCount: 1 })], 1));
      snowflake$.complete();
      await settle();

      live$.next(
        response(
          [row('p-1', 'Ada Lovelace', { commitsCount: 1 }), row('live-x', 'Grace Hopper', { sources: ['committee'], seatsCount: 1, committeeSeatsCount: 1 })],
          2
        )
      );
      live$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-live-x', 'org-people-all-employees-row-p-1']);
      expect(activeStat()).toContain('2');
    });

    it('keeps the Snowflake rows, with no error state, when the live merge fails', async () => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace')], 1));
      snowflake$.complete();
      await settle();

      live$.error(new Error('504'));
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();
    });

    // The server's live merge answers with live sources only when its own stored-roster read failed;
    // that partial list must not replace a full stored roster already on screen.
    it('keeps the Snowflake rows when the live merge arrives without any stored-roster rows', async () => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace', { commitsCount: 1 }), row('p-2', 'Alan Turing', { commitsCount: 1 })], 2));
      snowflake$.complete();
      await settle();

      live$.next(response([row('live-x', 'Grace Hopper', { sources: ['access'] })], 1));
      live$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-2']);
      expect(activeStat()).toContain('2');
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();
    });

    it('shows a live-only merge as-is when the Snowflake roster was empty', async () => {
      snowflake$.next(response([], 0));
      snowflake$.complete();
      await settle();

      live$.next(response([row('live-x', 'Grace Hopper', { sources: ['access'] })], 1));
      live$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-live-x']);
    });

    it('holds a live-only merge that lands first, and shows it once the Snowflake roster comes back empty', async () => {
      live$.next(response([row('live-x', 'Grace Hopper', { sources: ['access'] })], 1));
      live$.complete();
      await settle();
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();

      snowflake$.next(response([], 0));
      snowflake$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-live-x']);
    });

    it('holds a live-only merge that lands first, and shows it once the Snowflake roster fails', async () => {
      live$.next(response([row('live-x', 'Grace Hopper', { sources: ['access'] })], 1));
      live$.complete();
      await settle();

      snowflake$.error(new Error('500'));
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-live-x']);
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();
    });

    it('ignores a Snowflake roster that arrives after the live merge has landed', async () => {
      live$.next(
        response(
          [row('p-1', 'Ada Lovelace', { commitsCount: 1 }), row('live-x', 'Grace Hopper', { sources: ['committee'], seatsCount: 1, committeeSeatsCount: 1 })],
          2
        )
      );
      live$.complete();
      await settle();

      snowflake$.next(response([row('p-1', 'Ada Lovelace')], 1));
      snowflake$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-live-x', 'org-people-all-employees-row-p-1']);
      expect(activeStat()).toContain('2');
    });

    it('still renders the Snowflake roster, with no error state, when the live merge fails first', async () => {
      live$.error(new Error('504'));
      await settle();
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();

      snowflake$.next(response([row('p-1', 'Ada Lovelace')], 1));
      snowflake$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();
    });

    it('falls back to the live merge when the Snowflake roster fails', async () => {
      snowflake$.error(new Error('500'));
      await settle();
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();

      live$.next(response([row('live-x', 'Grace Hopper', { sources: ['access'] })], 1));
      live$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-live-x']);
    });

    it.each([
      ['Snowflake first', ['snowflake', 'live'] as const],
      ['live first', ['live', 'snowflake'] as const],
    ])('shows the error state only when both sources fail (%s)', async (_label, order) => {
      const sources = { snowflake: snowflake$, live: live$ };
      sources[order[0]].error(new Error('first'));
      await settle();
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();

      sources[order[1]].error(new Error('second'));
      await settle();

      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).not.toBeNull();
    });
  });

  // The directory service replays a cached response synchronously on subscribe, so a live-only
  // merge cached by an earlier visit reaches the component before Snowflake can answer.
  describe('in the browser, with a live-only merge already cached', () => {
    beforeEach(async () => {
      getDirectory.mockImplementation(() => of(response([row('live-x', 'Grace Hopper', { sources: ['access'] })], 1)));
      getFormerEmployees.mockImplementation(() => of(response([], 0)));
      await mount('browser');
    });

    it('keeps the skeleton until Snowflake answers, then keeps the Snowflake rows', async () => {
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();

      snowflake$.next(response([row('p-1', 'Ada Lovelace'), row('p-2', 'Alan Turing')], 2));
      snowflake$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-2']);
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();
    });
  });

  // lfx-self-serve#4311 — former employees are a separate read, listed only when a view that includes them is picked.
  describe('in the browser, with the employment filter', () => {
    const answerCurrent = async (): Promise<void> => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace', { commitsCount: 1 })], 1));
      snowflake$.complete();
      await settle();
    };
    const answerFormer = async (): Promise<void> => {
      former$.next(response([row('p-9', 'Grace Hopper', { isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();
    };

    it('reads former employees under "Current employees" too, for reconciliation, but lists none, and waits for that read', async () => {
      await mount('browser');
      await answerCurrent();

      expect(getFormerEmployees).toHaveBeenCalledWith(ORG, '365d', FILTERS);
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();

      await answerFormer();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
      expect(formerTags()).toEqual([]);
      expect(activeStat()).toContain('1');
    });

    it('shows only former employees, tagged, with their own tiles, under "Former employees"', async () => {
      await mount('browser');
      await answerCurrent();

      // The employment select's form control; PrimeNG's overlay select is not driven from jsdom.
      const component = fixture.componentInstance as unknown as { filterForm: FormGroup<{ employment: FormControl<OrgAllEmployeeEmploymentFilter> }> };
      component.filterForm.controls.employment.setValue('former');
      await settle();
      await answerFormer();

      expect(getFormerEmployees).toHaveBeenCalledTimes(1);
      expect(getFormerEmployees).toHaveBeenCalledWith(ORG, '365d', FILTERS);
      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual(['org-people-all-employees-row-p-9-former']);
      expect(activeStat()).toContain('1');
      expect(TestBed.inject(Router).url).toContain('employment=former');
    });

    it('shows current and former employees together, with summed tiles, under "All"', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      await answerFormer();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual(['org-people-all-employees-row-p-9-former']);
      expect(activeStat()).toContain('2');
    });
    it('follows ?employment= when the URL changes after load', async () => {
      await mount('browser');
      await answerCurrent();

      await TestBed.inject(Router).navigateByUrl('/?employment=former');
      await settle();
      await answerFormer();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-9']);
    });

    it('shows a former employee who still holds Org Lens access once, as former, with the access badge, under "All"', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      live$.next(
        response([row('p-1', 'Ada Lovelace'), row('live-grace', 'Grace Hopper', { lfUsername: 'grace', sources: ['access'], accessBadge: 'viewer' })], 1)
      );
      live$.complete();
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(el().querySelector('[data-testid="org-people-all-employees-access-p-9"]')?.textContent).toContain('Viewer');
    });

    it('never lists a former employee the server tagged as holding only Org Lens access under "Current employees"', async () => {
      await mount('browser');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace', 'Grace Hopper', { lfUsername: 'grace', sources: ['access'], accessBadge: 'viewer', isFormer: true }),
          ],
          1
        )
      );
      live$.complete();
      former$.next(response([], 0));
      former$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
      expect(formerTags()).toEqual([]);
    });

    it('folds the stored activity of someone with a live seat into their current row, tiles included, under "Current employees"', async () => {
      await mount('browser');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace', 'Grace Hopper', { lfUsername: 'grace', sources: ['committee'], seatsCount: 1, committeeSeatsCount: 1 }),
          ],
          2
        )
      );
      live$.complete();
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual([]);
      expect(el().querySelector('[data-testid="org-people-all-employees-row-p-9"]')?.textContent).toContain('4 commits');
      expect(el().querySelector('[data-testid="org-people-all-employees-stat-code"]')?.textContent).toContain('2');
      expect(el().querySelector('[data-testid="org-people-all-employees-stat-governance"]')?.textContent).toContain('1');
    });

    it('keeps the skeleton under "Former employees" until the current roster has answered, then leaves out who is current', async () => {
      await mount('browser', '/?employment=former');
      former$.next(
        response(
          [
            row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 }),
            row('p-8', 'Alan Turing', { lfUsername: 'alan', isFormer: true, commitsCount: 2 }),
          ],
          2
        )
      );
      former$.complete();
      await settle();

      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();
      expect(rowKeys()).toEqual([]);

      await answerCurrent();
      snowflake$ = new Subject();
      live$ = new Subject();
      former$ = new Subject();
      await TestBed.inject(Router).navigateByUrl('/?employment=former&range=30d');
      await settle();
      // The new range's former roster lands while its current roster is still pending.
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 1 })], 1));
      former$.complete();
      await settle();

      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();

      snowflake$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', commitsCount: 1 })], 1));
      snowflake$.complete();
      await settle();

      expect(rowKeys()).toEqual([]);
      expect(el().querySelector('[data-testid="org-people-all-employees-empty"]')).not.toBeNull();
    });

    it('keeps the current employees under "All" when the former read fails, with an inline warning instead of the error state', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      former$.error(new Error('500'));
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
      expect(el().querySelector('[data-testid="org-people-all-employees-former-error"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();
      expect(activeStat()).toContain('1');
    });

    it('shows the error state under "Former employees" and neither the error nor the warning under "Current employees" when the former read fails', async () => {
      const warning = (): Element | null => el().querySelector('[data-testid="org-people-all-employees-former-error"]');
      const error = (): Element | null => el().querySelector('[data-testid="org-people-all-employees-error"]');
      await mount('browser', '/?employment=former');
      await answerCurrent();
      former$.error(new Error('500'));
      await settle();

      expect(error()).not.toBeNull();
      expect(warning()).toBeNull();

      await TestBed.inject(Router).navigateByUrl('/');
      await settle();

      expect(error()).toBeNull();
      expect(warning()).toBeNull();
      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
    });

    it('shows a server-tagged former access principal once, as the former row with the access badge, under "All"', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace', 'Grace Hopper', { lfUsername: 'grace', sources: ['access'], accessBadge: 'viewer', isFormer: true }),
          ],
          1
        )
      );
      live$.complete();
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual(['org-people-all-employees-row-p-9-former']);
      expect(el().querySelector('[data-testid="org-people-all-employees-access-p-9"]')?.textContent).toContain('Viewer');
    });

    it('shows someone with a live seat as one current row that keeps their code and takes their access badge, under "All"', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace', 'Grace Hopper', { lfUsername: 'grace', sources: ['committee'], seatsCount: 1, committeeSeatsCount: 1 }),
            row('live-grace-access', 'Grace Hopper', { lfUsername: 'grace', sources: ['access'], accessBadge: 'admin' }),
          ],
          2
        )
      );
      live$.complete();
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual([]);
      expect(el().querySelector('[data-testid="org-people-all-employees-row-p-9"]')?.textContent).toContain('4 commits');
      expect(el().querySelector('[data-testid="org-people-all-employees-access-p-9"]')?.textContent).toContain('Admin');
      expect(el().querySelector('[data-testid="org-people-all-employees-stat-code"]')?.textContent).toContain('2');
    });

    it('names a rejoined person from the live row when the former row only has the placeholder, never from an address', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace', 'Grace Hopper', {
              lfUsername: 'grace',
              firstName: 'Grace',
              lastName: 'Hopper',
              title: 'Rear Admiral',
              avatarUrl: 'https://img.example/grace.png',
              email: 'grace@navy.example',
              sources: ['committee'],
              seatsCount: 1,
              committeeSeatsCount: 1,
            }),
            row('live-alan', 'alan@personal.example', {
              lfUsername: 'alan',
              email: 'alan@personal.example',
              sources: ['board'],
              seatsCount: 1,
              boardSeatsCount: 1,
            }),
          ],
          3
        )
      );
      live$.complete();
      former$.next(
        response(
          [
            row('p-9', 'Unknown member', { lfUsername: 'grace', firstName: 'Unknown', lastName: 'member', isFormer: true, commitsCount: 4 }),
            row('p-8', 'Unknown member', { lfUsername: 'alan', firstName: 'Unknown', lastName: 'member', isFormer: true, commitsCount: 2 }),
          ],
          2
        )
      );
      former$.complete();
      await settle();

      const rows = (fixture.componentInstance as unknown as { viewRows(): OrgAllEmployeeRow[] }).viewRows();
      const grace = rows.find((r) => r.personKey === 'p-9');
      expect(grace).toMatchObject({
        name: 'Grace Hopper',
        firstName: 'Grace',
        lastName: 'Hopper',
        title: 'Rear Admiral',
        avatarUrl: 'https://img.example/grace.png',
      });
      expect(grace?.email).toBeNull();
      expect(rows.find((r) => r.personKey === 'p-8')?.name).toBe('Unknown member');
      expect(JSON.stringify(rows.filter((r) => r.personKey.startsWith('p-')))).not.toContain('@');

      (fixture.componentInstance as unknown as { searchTerm: WritableSignal<string> }).searchTerm.set('hopper');
      await settle();
      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-9']);
    });

    it('never joins a key contact on username: the key-contact row and the former row both stay, under "All"', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      live$.next(
        response([row('p-1', 'Ada Lovelace', { commitsCount: 1 }), row('live-grace-kc', 'Grace Hopper', { lfUsername: 'grace', sources: ['keyContact'] })], 1)
      );
      live$.complete();
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-live-grace-kc', 'org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual(['org-people-all-employees-row-p-9-former']);
    });

    it('joins a key contact the server merged into a verified access principal: one current row with code and badge, under "All"', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace', 'Grace Hopper', { lfUsername: 'grace', sources: ['access', 'keyContact'], accessBadge: 'viewer' }),
          ],
          1
        )
      );
      live$.complete();
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual([]);
      expect(el().querySelector('[data-testid="org-people-all-employees-row-p-9"]')?.textContent).toContain('4 commits');
      expect(el().querySelector('[data-testid="org-people-all-employees-access-p-9"]')?.textContent).toContain('Viewer');
    });

    it('never joins a key contact a pending invite folded into: the key-contact row and the former row both stay, under "All"', async () => {
      await mount('browser', '/?employment=all');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace-kc', 'Grace Hopper', { lfUsername: 'grace', sources: ['keyContact', 'access'], accessBadge: 'invited' }),
          ],
          1
        )
      );
      live$.complete();
      former$.next(response([row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 })], 1));
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-live-grace-kc', 'org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual(['org-people-all-employees-row-p-9-former']);
    });

    it('shows someone on both warehouse rosters (one cache stale after a build) once, as the stored current row, under "All"', async () => {
      await mount('browser', '/?employment=all');
      snowflake$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('p-9', 'Grace Hopper', { lfUsername: 'grace', commitsCount: 4 }),
            row('p-7', 'Alan Turing', { lfUsername: 'alan', commitsCount: 2 }),
          ],
          3
        )
      );
      snowflake$.complete();
      former$.next(
        response(
          [
            row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 }),
            row('p-8', 'Alan Turing', { lfUsername: 'alan', isFormer: true, commitsCount: 2 }),
          ],
          2
        )
      );
      former$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-7', 'org-people-all-employees-row-p-9']);
      expect(formerTags()).toEqual([]);
      expect(activeStat()).toContain('3');
    });

    it('leaves out of the Former view a stored current seat-holder still on a stale former roster', async () => {
      await mount('browser', '/?employment=former');
      snowflake$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('p-9', 'Grace Hopper', { lfUsername: 'grace', sources: ['snowflake', 'committee'], seatsCount: 1, committeeSeatsCount: 1 }),
          ],
          2
        )
      );
      snowflake$.complete();
      former$.next(
        response(
          [
            row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 }),
            row('p-8', 'Alan Turing', { lfUsername: 'alan', isFormer: true, commitsCount: 2 }),
          ],
          2
        )
      );
      former$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-8']);
      expect(formerTags()).toEqual(['org-people-all-employees-row-p-8-former']);
    });

    it("never joins the previous account's live roster to the next account's former employees during a switch", async () => {
      await mount('browser', '/?employment=former');
      await answerCurrent();
      live$.next(
        response(
          [
            row('p-1', 'Ada Lovelace', { commitsCount: 1 }),
            row('live-grace', 'Grace Hopper', { lfUsername: 'grace', sources: ['committee'], seatsCount: 1, committeeSeatsCount: 1 }),
            row('live-alan', 'Alan Turing', { lfUsername: 'alan', sources: ['access'], accessBadge: 'admin' }),
          ],
          1
        )
      );
      live$.complete();
      former$.next(response([], 0));
      former$.complete();
      await settle();

      // The next account's reads: its live roster is still pending while its former roster lands.
      snowflake$ = new Subject();
      live$ = new Subject();
      former$ = new Subject();
      selectedAccount.set({ uid: OTHER_ORG, accountName: 'Other Org' });
      await settle();
      former$.next(
        response(
          [
            row('p-9', 'Grace Hopper', { lfUsername: 'grace', isFormer: true, commitsCount: 4 }),
            row('p-8', 'Alan Turing', { lfUsername: 'alan', isFormer: true, commitsCount: 2 }),
          ],
          2,
          OTHER_ORG
        )
      );
      former$.complete();
      await settle();

      expect(getFormerEmployees).toHaveBeenLastCalledWith(OTHER_ORG, '365d', FILTERS);
      // The table waits for the next account's current roster; the reconciled rows never take the previous account's.
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();
      const roster = (fixture.componentInstance as unknown as { rosterRows: () => OrgAllEmployeeRow[] }).rosterRows();
      expect(roster.map((r) => [r.personKey, r.isFormer, r.accessBadge ?? null]).sort()).toEqual([
        ['p-8', true, null],
        ['p-9', true, null],
      ]);

      snowflake$.next(response([], 0, OTHER_ORG));
      snowflake$.complete();
      await settle();

      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-8', 'org-people-all-employees-row-p-9']);
      expect(formerTags().sort()).toEqual(['org-people-all-employees-row-p-8-former', 'org-people-all-employees-row-p-9-former']);
      expect(el().querySelector('[data-testid="org-people-all-employees-access-p-8"]')?.textContent).not.toContain('Admin');
    });

    it('drops the previous account\'s current employees from the roster and foundation dropdown during a switch, under "All"', async () => {
      const foundationValues = (): string[] =>
        (fixture.componentInstance as unknown as { foundationOptions: () => { value: string }[] }).foundationOptions().map((option) => option.value);
      await mount('browser', '/?employment=all');
      const previous = {
        ...response([row('p-1', 'Ada Lovelace', { commitsCount: 1, engagedFoundationIds: ['cncf'] })], 1),
        foundations: [{ foundationId: 'cncf', foundationName: 'CNCF' }],
      };
      snowflake$.next(previous);
      snowflake$.complete();
      live$.next(previous);
      live$.complete();
      former$.next(response([], 0));
      former$.complete();
      await settle();
      expect(foundationValues()).toEqual(['', 'cncf']);

      // The next account's former roster lands while its current reads are still pending.
      snowflake$ = new Subject();
      live$ = new Subject();
      former$ = new Subject();
      selectedAccount.set({ uid: OTHER_ORG, accountName: 'Other Org' });
      await settle();
      former$.next({
        ...response([row('p-9', 'Grace Hopper', { isFormer: true, commitsCount: 4, engagedFoundationIds: ['lf'] })], 1, OTHER_ORG),
        foundations: [{ foundationId: 'lf', foundationName: 'LF' }],
      });
      former$.complete();
      await settle();

      expect(foundationValues()).toEqual(['', 'lf']);
      const rosterKeys = (fixture.componentInstance as unknown as { rosterRows: () => { personKey: string }[] }).rosterRows().map((r) => r.personKey);
      expect(rosterKeys).toEqual(['p-9']);
    });
  });

  // lfx-self-serve#4163 — every roster read follows the selected time range, which lives in `?range=`.
  describe('in the browser, with the time range filter', () => {
    const component = (): {
      onRangeChange(value: OrgLensTimeRange): void;
      selectedFoundationId: WritableSignal<string>;
      filterForm: FormGroup<{ foundation: FormControl<string> }>;
    } =>
      fixture.componentInstance as unknown as {
        onRangeChange(value: OrgLensTimeRange): void;
        selectedFoundationId: WritableSignal<string>;
        filterForm: FormGroup<{ foundation: FormControl<string> }>;
      };
    const answer = async (subject: Subject<OrgAllEmployeesResponse>, value: OrgAllEmployeesResponse): Promise<void> => {
      subject.next(value);
      subject.complete();
      await settle();
    };

    it('reads ?range= on load and requests the stored, live and former rosters for it', async () => {
      await mount('browser', '/?range=30d&employment=all');

      expect(getAllEmployees).toHaveBeenCalledWith(ORG, '30d', FILTERS);
      expect(getDirectory).toHaveBeenCalledWith(ORG, '30d', FILTERS);
      expect(getFormerEmployees).toHaveBeenCalledWith(ORG, '30d', FILTERS);
    });

    it('ignores an unknown ?range= and reads the default range', async () => {
      await mount('browser', '/?range=3y');

      expect(getAllEmployees).toHaveBeenCalledWith(ORG, '365d', FILTERS);
      expect(getDirectory).toHaveBeenCalledWith(ORG, '365d', FILTERS);
    });

    it('refetches current and former employees on a range change and writes ?range=, dropping the default', async () => {
      await mount('browser', '/?employment=all');
      await answer(snowflake$, response([row('p-1', 'Ada Lovelace', { commitsCount: 1 })], 1));
      await answer(former$, response([], 0));

      snowflake$ = new Subject();
      live$ = new Subject();
      former$ = new Subject();
      component().onRangeChange('all');
      await settle();
      await answer(snowflake$, response([row('p-1', 'Ada Lovelace', { commitsCount: 9 }), row('p-2', 'Alan Turing', { commitsCount: 3 })], 2));
      await answer(former$, response([row('p-9', 'Grace Hopper', { isFormer: true, commitsCount: 4 })], 1));

      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, 'all', FILTERS);
      expect(getDirectory).toHaveBeenLastCalledWith(ORG, 'all', FILTERS);
      expect(getFormerEmployees).toHaveBeenLastCalledWith(ORG, 'all', FILTERS);
      expect(rowKeys().sort()).toEqual(['org-people-all-employees-row-p-1', 'org-people-all-employees-row-p-2', 'org-people-all-employees-row-p-9']);
      expect(activeStat()).toContain('3');
      expect(TestBed.inject(Router).url).toContain('range=all');

      component().onRangeChange('365d');
      await settle();

      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, '365d', FILTERS);
      expect(TestBed.inject(Router).url).not.toContain('range=');
      expect(TestBed.inject(Router).url).toContain('employment=all');
    });

    it('follows ?range= when the URL changes after load', async () => {
      await mount('browser');

      await TestBed.inject(Router).navigateByUrl('/?range=90d');
      await settle();

      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, '90d', FILTERS);
      expect(getDirectory).toHaveBeenLastCalledWith(ORG, '90d', FILTERS);
    });

    it('drops a picked foundation the new range no longer lists, once that range has loaded, from the select too', async () => {
      getFormerEmployees.mockImplementation(() => of(response([], 0)));
      await mount('browser');
      const foundation = { foundationId: 'f-1', foundationName: 'Foundation One' };
      await answer(snowflake$, { ...response([row('p-1', 'Ada Lovelace', { commitsCount: 1, engagedFoundationIds: ['f-1'] })], 1), foundations: [foundation] });
      component().filterForm.controls.foundation.setValue('f-1');
      await settle();

      snowflake$ = new Subject();
      live$ = new Subject();
      component().onRangeChange('30d');
      await settle();
      expect(component().selectedFoundationId()).toBe('f-1');

      await answer(snowflake$, response([row('p-2', 'Alan Turing', { commitsCount: 1 })], 1));

      expect(component().selectedFoundationId()).toBe('');
      expect(component().filterForm.controls.foundation.value).toBe('');
      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-2']);
    });

    it('keeps a picked foundation the new range still lists', async () => {
      getFormerEmployees.mockImplementation(() => of(response([], 0)));
      await mount('browser');
      const foundation = { foundationId: 'f-1', foundationName: 'Foundation One' };
      await answer(snowflake$, { ...response([row('p-1', 'Ada Lovelace', { commitsCount: 1, engagedFoundationIds: ['f-1'] })], 1), foundations: [foundation] });
      component().selectedFoundationId.set('f-1');
      await settle();

      snowflake$ = new Subject();
      live$ = new Subject();
      component().onRangeChange('all');
      await settle();
      await answer(snowflake$, { ...response([row('p-1', 'Ada Lovelace', { commitsCount: 5, engagedFoundationIds: ['f-1'] })], 1), foundations: [foundation] });

      expect(component().selectedFoundationId()).toBe('f-1');
      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
    });

    it('offers only foundations a listed person engaged with in the range, and drops a picked one the new range lacks', async () => {
      const foundations = [
        { foundationId: 'f-1', foundationName: 'Foundation One' },
        { foundationId: 'f-2', foundationName: 'Foundation Two' },
      ];
      const optionValues = (): string[] =>
        (fixture.componentInstance as unknown as { foundationOptions(): { value: string }[] }).foundationOptions().map((option) => option.value);
      getFormerEmployees.mockImplementation(() => of(response([], 0)));
      await mount('browser');
      await answer(snowflake$, { ...response([row('p-1', 'Ada Lovelace', { commitsCount: 1, engagedFoundationIds: ['f-1'] })], 1), foundations });

      expect(optionValues()).toEqual(['', 'f-1']);
      component().selectedFoundationId.set('f-1');
      await settle();

      // The foundation list still names both (it is not windowed), but nobody listed in 30 days engaged with f-1.
      snowflake$ = new Subject();
      live$ = new Subject();
      component().onRangeChange('30d');
      await settle();
      await answer(snowflake$, { ...response([row('p-2', 'Alan Turing', { commitsCount: 1, engagedFoundationIds: ['f-2'] })], 1), foundations });

      expect(optionValues()).toEqual(['', 'f-2']);
      expect(component().selectedFoundationId()).toBe('');
      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-2']);
    });

    it('offers the former and "All" views only the foundations their listed rows engaged with', async () => {
      const foundations = [
        { foundationId: 'f-1', foundationName: 'Foundation One' },
        { foundationId: 'f-2', foundationName: 'Foundation Two' },
        { foundationId: 'f-3', foundationName: 'Foundation Three' },
      ];
      const optionValues = (): string[] =>
        (fixture.componentInstance as unknown as { foundationOptions(): { value: string }[] }).foundationOptions().map((option) => option.value);
      await mount('browser', '/?employment=former');
      await answer(snowflake$, { ...response([row('p-1', 'Ada Lovelace', { commitsCount: 1, engagedFoundationIds: ['f-1'] })], 1), foundations });
      await answer(former$, { ...response([row('p-9', 'Grace Hopper', { isFormer: true, commitsCount: 4, engagedFoundationIds: ['f-2'] })], 1), foundations });

      expect(optionValues()).toEqual(['', 'f-2']);

      await TestBed.inject(Router).navigateByUrl('/?employment=all');
      await settle();

      expect(optionValues()).toEqual(['', 'f-1', 'f-2']);
    });
  });

  // lfx-self-serve#4164 — the commit filters live in `?projectScope=` / `?metric=` (one code-count dropdown) and reach every roster read.
  describe('in the browser, with the commit filters', () => {
    const component = (): { onFiltersChange(change: Partial<OrgCodeFilterValues>): void; metricOptions: { label: string }[] } =>
      fixture.componentInstance as unknown as { onFiltersChange(change: Partial<OrgCodeFilterValues>): void; metricOptions: { label: string }[] };
    const text = (testId: string): string => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
    const picked: OrgCommitFilters = { projectScope: 'lf', commitScope: 'all', metric: 'code' };

    it('offers one code-count dropdown, Commits by default', async () => {
      await mount('browser');

      expect(component().metricOptions.map((option) => option.label)).toEqual(['All commits', 'Only main branch commits', 'All code contributions']);
      expect(el().querySelector('[data-testid="org-people-all-employees-commit-scope-filter"]')).toBeNull();
      expect(getAllEmployees).toHaveBeenCalledWith(ORG, '365d', FILTERS);
    });

    it('reads the filters on load and requests the stored, live and former rosters with them', async () => {
      await mount('browser', '/?employment=all&projectScope=lf&metric=code');

      expect(getAllEmployees).toHaveBeenCalledWith(ORG, '365d', picked);
      expect(getDirectory).toHaveBeenCalledWith(ORG, '365d', picked);
      expect(getFormerEmployees).toHaveBeenCalledWith(ORG, '365d', picked);
    });

    it('reads an unknown value as its default', async () => {
      await mount('browser', '/?projectScope=LF&commitScope=main&metric=prs');

      expect(getAllEmployees).toHaveBeenCalledWith(ORG, '365d', FILTERS);
    });

    it('opens a legacy commitScope=merged link as Only main branch commits and rewrites it to metric=merged', async () => {
      await mount('browser', '/?employment=all&commitScope=merged');

      expect(getAllEmployees).toHaveBeenCalledWith(ORG, '365d', { ...FILTERS, commitScope: 'merged' });
      const url = TestBed.inject(Router).url;
      expect(url).toContain('metric=merged');
      expect(url).not.toContain('commitScope=');
      expect(url).toContain('employment=all');
    });

    it.each([
      ['merged', { commitScope: 'merged', metric: 'commits' }],
      ['code', { commitScope: 'all', metric: 'code' }],
    ] as const)('sends metric=%s to every roster read as %o and writes it to the URL', async (metric, params) => {
      await mount('browser', '/?employment=all');

      component().onFiltersChange({ metric });
      await settle();

      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, ...params });
      expect(getDirectory).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, ...params });
      expect(getFormerEmployees).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, ...params });
      const url = TestBed.inject(Router).url;
      expect(url).toContain(`metric=${metric}`);
      expect(url).not.toContain('commitScope=');
    });

    it('refetches on a change and writes the params, dropping defaults', async () => {
      await mount('browser', '/?employment=all');

      component().onFiltersChange({ projectScope: 'non_lf' });
      await settle();

      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, projectScope: 'non_lf' });
      expect(getDirectory).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, projectScope: 'non_lf' });
      expect(getFormerEmployees).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, projectScope: 'non_lf' });
      const url = TestBed.inject(Router).url;
      expect(url).toContain('projectScope=non_lf');
      expect(url).not.toContain('commitScope=');
      expect(url).not.toContain('metric=');
      expect(url).toContain('employment=all');

      component().onFiltersChange({ projectScope: 'all' });
      await settle();

      expect(TestBed.inject(Router).url).not.toContain('projectScope=');
    });

    it('follows the params when the URL changes after load', async () => {
      await mount('browser');

      await TestBed.inject(Router).navigateByUrl('/?metric=merged');
      await settle();

      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, commitScope: 'merged' });

      await TestBed.inject(Router).navigateByUrl('/?metric=code');
      await settle();

      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, '365d', { ...FILTERS, metric: 'code' });
    });

    it('shows Clear filters only while a filter is non-default, the code-count option included', async () => {
      const clear = (): HTMLButtonElement | null => el().querySelector('[data-testid="org-people-all-employees-clear-filters"]');
      await mount('browser', '/?tab=employees');

      expect(clear()).toBeNull();

      await TestBed.inject(Router).navigateByUrl('/?tab=employees&metric=merged');
      await settle();

      expect(clear()?.textContent?.trim()).toBe('Clear filters');
    });

    it('clears every filter to its default in one roster read and drops their URL params, keeping the tab', async () => {
      const clear = (): HTMLButtonElement | null => el().querySelector('[data-testid="org-people-all-employees-clear-filters"]');
      await mount('browser', '/?tab=employees&employment=all&range=90d&projectScope=lf&metric=code');
      const state = fixture.componentInstance as unknown as {
        filterForm: FormGroup<{ search: FormControl<string>; activity: FormControl<string> }>;
        searchTerm(): string;
        selectedActivity(): string;
        selectedFoundationId(): string;
        selectedEmployment(): string;
        selectedRange(): string;
      };
      state.filterForm.controls.search.setValue('ada');
      state.filterForm.controls.activity.setValue('code');
      await settle();
      expect([state.searchTerm(), state.selectedActivity()]).toEqual(['ada', 'code']);
      const reads = getDirectory.mock.calls.length;

      clear()?.click();
      await settle();

      expect([state.searchTerm(), state.selectedFoundationId(), state.selectedActivity(), state.selectedEmployment(), state.selectedRange()]).toEqual([
        '',
        '',
        'all',
        'current',
        '365d',
      ]);
      expect(state.filterForm.getRawValue()).toEqual({
        search: '',
        foundation: '',
        activity: 'all',
        employment: 'current',
        range: '365d',
        projectScope: FILTERS.projectScope,
        metric: FILTERS.metric,
      });
      // The range and the commit filters change together, so no read starts for a half-cleared combination.
      expect(getDirectory.mock.calls.slice(reads)).toEqual([[ORG, '365d', FILTERS]]);
      expect(getAllEmployees).toHaveBeenLastCalledWith(ORG, '365d', FILTERS);
      expect(TestBed.inject(Router).url).toBe('/?tab=employees');
      expect(clear()).toBeNull();
    });

    it('labels the count column, its badges, the code tile and the activity option after the metric', async () => {
      getFormerEmployees.mockImplementation(() => of(response([], 0)));
      await mount('browser');
      snowflake$.next(response([row('p-1', 'Ada Lovelace', { commitsCount: 3 })], 1));
      snowflake$.complete();
      await settle();

      expect(text('org-people-all-employees-code-header')).toBe('Commits');
      expect(text('org-people-all-employees-stat-code-label')).toBe('Committers');
      expect(el().querySelector('[data-testid="org-people-all-employees-rows"]')?.textContent).toContain('3 commits');
      const tooltip = (): unknown =>
        fixture.debugElement.query(By.css('[data-testid="org-people-all-employees-code-header-info"]')).injector.get(Tooltip).content;
      expect(tooltip()).toBe(ORG_COMMITS_DEFINITION);

      snowflake$ = new Subject();
      live$ = new Subject();
      component().onFiltersChange({ metric: 'merged' });
      await settle();
      snowflake$.next(response([row('p-1', 'Ada Lovelace', { commitsCount: 2 })], 1));
      snowflake$.complete();
      await settle();

      expect(text('org-people-all-employees-code-header')).toBe('Commits');
      expect(tooltip()).toBe(ORG_MAIN_BRANCH_COMMITS_DEFINITION);

      snowflake$ = new Subject();
      live$ = new Subject();
      component().onFiltersChange({ metric: 'code' });
      await settle();
      snowflake$.next(response([row('p-1', 'Ada Lovelace', { commitsCount: 1 })], 1));
      snowflake$.complete();
      await settle();

      expect(text('org-people-all-employees-code-header')).toBe('Code contributions');
      expect(text('org-people-all-employees-stat-code-label')).toBe('Code Contributors');
      expect(el().querySelector('[data-testid="org-people-all-employees-rows"]')?.textContent).toContain('1 contribution');
      expect(tooltip()).toBe(ORG_CODE_CONTRIBUTIONS_DEFINITION);
      const activityOptions = (fixture.componentInstance as unknown as { activityOptions(): { label: string; value: string }[] }).activityOptions();
      expect(activityOptions.find((option) => option.value === 'code')?.label).toBe('Code contributions');
    });

    it('keeps the active tile across every code-count option while the code tile follows the option', async () => {
      const tile = (name: string): string => el().querySelector(`[data-testid="org-people-all-employees-stat-${name}"] div`)?.textContent?.trim() ?? '';
      // Each option's picked count; the code activities stay the same whatever is picked.
      const picked = { commits: [2, 0, 1], merged: [1, 0, 0], code: [6, 3, 2] } as const;
      const answer = async ([ada, grace, alan]: readonly number[]): Promise<void> => {
        const current = [
          row('p-1', 'Ada Lovelace', { commitsCount: ada, codeActivitiesCount: 6 }),
          // Reviews only: no commit, but code activities.
          row('p-2', 'Grace Hopper', { commitsCount: grace, codeActivitiesCount: 3 }),
        ];
        snowflake$.next(response(current, 2));
        snowflake$.complete();
        live$.next(response(current, 2));
        live$.complete();
        former$.next(response([row('p-9', 'Alan Turing', { isFormer: true, commitsCount: alan, codeActivitiesCount: 2 })], 1));
        former$.complete();
        await settle();
      };

      await mount('browser', '/?employment=all');
      await answer(picked.commits);
      expect([tile('active'), tile('code')]).toEqual(['3', '2']);

      for (const [metric, expectedCode] of [
        ['merged', '1'],
        ['code', '3'],
      ] as const) {
        snowflake$ = new Subject();
        live$ = new Subject();
        former$ = new Subject();
        component().onFiltersChange({ metric });
        await settle();
        await answer(picked[metric]);

        expect([tile('active'), tile('code')]).toEqual(['3', expectedCode]);
      }
    });
  });

  describe('on the server, with ?employment=former', () => {
    it('keeps the skeleton and requests nothing, so the browser render replaces it', async () => {
      await mount('server', '/?employment=former');

      expect(getFormerEmployees).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).not.toBeNull();
    });
  });
});
