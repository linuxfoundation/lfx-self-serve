// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY_ORG_ALL_EMPLOYEE_STATS } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeRow, OrgAllEmployeesResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { AllEmployeesService } from '../../services/all-employees.service';
import { AllEmployeesComponent } from './all-employees.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

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
    eventsCount: 0,
    coursesCount: 0,
    engagedFoundationIds: [],
    ...over,
  };
}

function response(rows: OrgAllEmployeeRow[], activeInOss: number): OrgAllEmployeesResponse {
  return { accountId: ORG, rows, stats: { ...EMPTY_ORG_ALL_EMPLOYEE_STATS, activeInOss }, foundations: [] };
}

describe('AllEmployeesComponent — Snowflake and live merge in parallel', () => {
  let snowflake$: Subject<OrgAllEmployeesResponse>;
  let live$: Subject<OrgAllEmployeesResponse>;
  let fixture: ComponentFixture<AllEmployeesComponent>;
  let getDirectory: Mock<(orgUid: string) => Subject<OrgAllEmployeesResponse>>;

  const el = (): HTMLElement => fixture.nativeElement;
  const rowKeys = (): string[] =>
    [...el().querySelectorAll<HTMLElement>('[data-testid^="org-people-all-employees-row-"]')]
      .map((r) => r.dataset['testid'] ?? '')
      .filter((id) => !id.endsWith('-name') && !id.endsWith('-detail-row'));
  const activeStat = (): string => el().querySelector('[data-testid="org-people-all-employees-stat-active"]')?.textContent ?? '';

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function mount(platformId: 'browser' | 'server'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AllEmployeesComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: AllEmployeesService, useValue: { getAllEmployees: vi.fn(() => snowflake$), getEmployeeDetail: vi.fn() } },
        { provide: OrgPeopleDirectoryStateService, useValue: { getDirectory, invalidate: vi.fn() } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AllEmployeesComponent);
    await settle();
  }

  beforeEach(() => {
    snowflake$ = new Subject();
    live$ = new Subject();
    getDirectory = vi.fn(() => live$);
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

    it('renders the Snowflake roster and never requests the live merge', async () => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace')], 1));
      snowflake$.complete();
      await settle();

      expect(getDirectory).not.toHaveBeenCalled();
      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
    });
  });

  describe('in the browser', () => {
    beforeEach(async () => {
      await mount('browser');
    });

    it('requests the live merge without waiting for the Snowflake roster', () => {
      expect(getDirectory).toHaveBeenCalledWith(ORG);
      expect(live$.observed).toBe(true);
    });

    it('renders the Snowflake roster and stats while the live merge is still pending', async () => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace')], 1));
      snowflake$.complete();
      await settle();

      expect(rowKeys()).toEqual(['org-people-all-employees-row-p-1']);
      expect(activeStat()).toContain('1');
      expect(el().querySelector('[data-testid="org-people-all-employees-table-skeleton"]')).toBeNull();
    });

    it('replaces the Snowflake rows with the live merge when it lands, without duplicating anyone', async () => {
      snowflake$.next(response([row('p-1', 'Ada Lovelace')], 1));
      snowflake$.complete();
      await settle();

      live$.next(response([row('p-1', 'Ada Lovelace'), row('live-x', 'Grace Hopper', { sources: ['access'] })], 2));
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

    it('ignores a Snowflake roster that arrives after the live merge has landed', async () => {
      live$.next(response([row('p-1', 'Ada Lovelace'), row('live-x', 'Grace Hopper', { sources: ['access'] })], 2));
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
});
