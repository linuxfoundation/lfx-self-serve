// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { provideRouter, Router } from '@angular/router';
import { EMPTY_ORG_TRAINEES_RESPONSE } from '@lfx-one/shared/constants';
import type { OrgLensTimeRange, OrgTraineeDetailRow, OrgTraineesResponse } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { TraineesService } from '../../services/trainees.service';
import { TraineesComponent } from './trainees.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

function detail(personKey: string, courseId: string, status: OrgTraineeDetailRow['status'], foundationId: string): OrgTraineeDetailRow {
  return {
    personKey,
    status,
    courseOrCertId: `${status}:${personKey}:${courseId}`,
    courseId,
    courseName: courseId,
    foundationId,
    foundationName: foundationId,
    activityTs: '2026-09-01T00:00:00.000Z',
  };
}

/** What the BFF returns per range: the last 30 days hold one enrollment, all time adds an older certified course elsewhere. */
function responseFor(range: OrgLensTimeRange): OrgTraineesResponse {
  const recent = detail('p-1', 'lfs101', 'Enrolled', 'lf');
  const older = [detail('p-1', 'cka', 'Certified', 'cncf'), detail('p-2', 'cka', 'Enrolled', 'cncf')];
  const details = range === '30d' ? [recent] : [recent, ...older];
  return {
    ...EMPTY_ORG_TRAINEES_RESPONSE,
    accountId: ORG,
    timeRange: range,
    trainees: [
      { personKey: 'p-1', lfid: null, cdpMemberId: null, name: 'Ada Lovelace', title: null, email: null },
      ...(range === '30d' ? [] : [{ personKey: 'p-2', lfid: null, cdpMemberId: null, name: 'Alan Turing', title: null, email: null }]),
    ],
    details,
    foundationOptions:
      range === '30d'
        ? [{ foundationId: 'lf', foundationName: 'lf' }]
        : [
            { foundationId: 'cncf', foundationName: 'cncf' },
            { foundationId: 'lf', foundationName: 'lf' },
          ],
    courseOptions: [...new Set(details.map((row) => row.courseId))].map((courseId) => ({ courseId, courseName: courseId })),
  };
}

describe('TraineesComponent — range (lfx-self-serve#4159)', () => {
  let fixture: ComponentFixture<TraineesComponent>;
  let getTrainees: Mock<(orgUid: string, range: OrgLensTimeRange) => Observable<OrgTraineesResponse>>;

  const el = (): HTMLElement => fixture.nativeElement;
  const stat = (name: string): string => el().querySelector(`[data-testid="org-people-trainees-stat-${name}"] .text-2xl`)?.textContent?.trim() ?? '';
  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;
  const router = (): Router => TestBed.inject(Router);

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(initialUrl: string): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [TraineesComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: TraineesService, useValue: { getTrainees } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await router().navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(TraineesComponent);
    await settle();
  }

  beforeEach(() => {
    getTrainees = vi.fn((_orgUid: string, range: OrgLensTimeRange) => of(responseFor(range)));
  });

  it('reads Past 365 days by default and the range another tab left in the URL', async () => {
    await mount('/?tab=training');
    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '365d');

    TestBed.resetTestingModule();
    await mount('/?tab=training&range=30d');
    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '30d');

    TestBed.resetTestingModule();
    await mount('/?tab=training&range=730d');
    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '730d');
  });

  it('fetches the picked range, writes it to the URL and recomputes the stat cards for it', async () => {
    await mount('/?tab=training&range=all');
    expect(stat('trainees')).toBe('2');
    expect(stat('certifications')).toBe('1');

    form().controls['timeRange'].setValue('30d');
    await settle();

    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '30d');
    expect(router().url).toBe('/?tab=training&range=30d');
    expect(stat('trainees')).toBe('1');
    expect(stat('courses-enrolled')).toBe('1');
    expect(stat('certifications')).toBe('0');
  });

  it('clears a picked foundation or course the new range no longer offers', async () => {
    await mount('/?tab=training&range=all');
    form().patchValue({ foundation: 'cncf', course: 'cka' });

    form().controls['timeRange'].setValue('30d');
    await settle();

    expect(form().getRawValue()).toMatchObject({ foundation: '', course: '' });
    expect(stat('trainees')).toBe('1');
  });

  it('follows a range written by another tab or a nav link without navigating again', async () => {
    await mount('/?tab=training');
    const navigate = vi.spyOn(router(), 'navigate');

    await router().navigateByUrl('/?tab=training&range=90d');
    await settle();

    expect(form().controls['timeRange'].value).toBe('90d');
    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '90d');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reads the picked range for the filtering state without waiting for the search debounce', async () => {
    await mount('/?tab=trainees');
    const isFiltering = (): boolean => (fixture.componentInstance as unknown as { isFiltering: () => boolean }).isFiltering();
    expect(isFiltering()).toBe(false);

    form().controls['timeRange'].setValue('30d');

    expect(isFiltering()).toBe(true);
  });

  it('opens the person drawer for the range the tab lists the person in', async () => {
    await mount('/?tab=trainees&range=30d');
    const open = (TestBed.inject(PersonDetailDrawerService) as unknown as { open: Mock }).open;

    (fixture.componentInstance as unknown as { onPersonClick(row: object, event: Event): void }).onPersonClick(
      { personKey: 'p-1', name: 'Ada Lovelace', title: null, initials: 'AL', avatarColorClass: '' },
      new Event('click')
    );

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ personKey: 'p-1', defaultTab: 'training', range: '30d' }));
  });
});
