// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY_ORG_ALL_EMPLOYEE_STATS } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeRow, OrgAllEmployeesResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllEmployeesService } from '../../services/all-employees.service';
import { AllEmployeesComponent } from './all-employees.component';

const ORG = '0014100000Te2ovAAB';

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

describe('AllEmployeesComponent — Snowflake first, live merge second', () => {
  let snowflake$: Subject<OrgAllEmployeesResponse>;
  let live$: Subject<OrgAllEmployeesResponse>;
  let fixture: ComponentFixture<AllEmployeesComponent>;

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

  beforeEach(async () => {
    snowflake$ = new Subject();
    live$ = new Subject();

    await TestBed.configureTestingModule({
      imports: [AllEmployeesComponent],
      providers: [
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: 'The Linux Foundation' }) } },
        { provide: AllEmployeesService, useValue: { getAllEmployees: vi.fn(() => snowflake$), getEmployeeDetail: vi.fn() } },
        { provide: OrgPeopleDirectoryStateService, useValue: { getDirectory: vi.fn(() => live$), invalidate: vi.fn() } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AllEmployeesComponent);
    await settle();
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

  it('falls back to the live merge when the Snowflake roster fails', async () => {
    snowflake$.error(new Error('500'));
    await settle();
    expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).toBeNull();

    live$.next(response([row('live-x', 'Grace Hopper', { sources: ['access'] })], 1));
    live$.complete();
    await settle();

    expect(rowKeys()).toEqual(['org-people-all-employees-row-live-x']);
  });

  it('shows the error state only when both sources fail', async () => {
    snowflake$.error(new Error('500'));
    await settle();
    live$.error(new Error('504'));
    await settle();

    expect(el().querySelector('[data-testid="org-people-all-employees-error"]')).not.toBeNull();
  });
});
