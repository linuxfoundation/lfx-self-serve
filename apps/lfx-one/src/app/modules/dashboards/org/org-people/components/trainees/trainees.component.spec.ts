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
import { firstValueFrom, Observable, of, timer } from 'rxjs';
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
    projectId: null,
    projectName: null,
    courseLevel: null,
    courseFormat: null,
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
      { personKey: 'p-1', lfid: null, cdpMemberId: null, name: 'Ada Lovelace', title: null, email: null, onPeopleList: true },
      ...(range === '30d' ? [] : [{ personKey: 'p-2', lfid: null, cdpMemberId: null, name: 'Alan Turing', title: null, email: null, onPeopleList: true }]),
    ],
    details,
    filterOptions: {
      ...EMPTY_ORG_TRAINEES_RESPONSE.filterOptions,
      foundations:
        range === '30d'
          ? [{ label: 'lf', value: 'lf' }]
          : [
              { label: 'cncf', value: 'cncf' },
              { label: 'lf', value: 'lf' },
            ],
      courses: [...new Set(details.map((row) => row.courseName))].map((name) => ({ label: name, value: name })),
    },
    asOf: '2026-10-30T09:48:21.094Z',
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

  it('reads Past 2 years by default and the range another tab left in the URL', async () => {
    await mount('/?tab=training');
    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '730d');

    TestBed.resetTestingModule();
    await mount('/?tab=training&range=30d');
    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '30d');

    TestBed.resetTestingModule();
    await mount('/?tab=training&range=365d');
    expect(getTrainees).toHaveBeenLastCalledWith(ORG, '365d');
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

  // lfx-self-serve#4290: every card states its unit, the picked range as its window, and the date the data reflects.
  it('states the picked range and the as-of date under each stat card', async () => {
    const caption = (name: string): string => el().querySelector(`[data-testid="org-people-trainees-stat-${name}-caption"]`)?.textContent ?? '';
    await mount('/?tab=training');

    for (const name of ['trainees', 'courses-enrolled', 'certifications', 'completion-rate']) {
      expect(caption(name)).toContain('Past 2 years');
      expect(caption(name)).toContain('Oct 30, 2026');
    }

    form().controls['timeRange'].setValue('all');
    await settle();

    expect(caption('trainees')).toContain('All time');
    expect(caption('trainees')).not.toContain('Past 2 years');
  });
});

/**
 * Three people over two projects: two course ids share the name "Kubernetes Basics" (course versions); the certificate
 * has a level and no format, as certified rows have upstream; the Linux course has no level. Past 30 days holds the
 * Linux enrollment only.
 */
function filterResponseFor(range: OrgLensTimeRange): OrgTraineesResponse {
  const row = (
    personKey: string,
    courseId: string,
    courseName: string,
    status: OrgTraineeDetailRow['status'],
    projectId: string,
    courseLevel: string | null,
    courseFormat: string | null
  ): OrgTraineeDetailRow => ({
    ...detail(personKey, courseId, status, 'foundation-a'),
    courseName,
    projectId,
    projectName: projectId,
    courseLevel,
    courseFormat,
  });
  const linux = row('p-3', 'lfs101', 'Linux Intro', 'Enrolled', 'proj-linux', null, 'E-Learning');
  const details =
    range === '30d'
      ? [linux]
      : [
          row('p-1', 'k8s-a', 'Kubernetes Basics', 'Enrolled', 'proj-k8s', 'Beginner', 'E-Learning'),
          row('p-1', 'cka', 'Kubernetes Admin', 'Certified', 'proj-k8s', 'Intermediate', null),
          row('p-2', 'k8s-b', 'Kubernetes Basics', 'Enrolled', 'proj-k8s', 'Beginner', 'Instructor Led'),
          linux,
        ];
  const options = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].sort().map((v) => ({ label: v, value: v }));
  const people = [
    { personKey: 'p-1', lfid: null, cdpMemberId: null, name: 'Ada Lovelace', title: 'Engineer', email: 'ada@example.com', onPeopleList: true },
    { personKey: 'p-2', lfid: null, cdpMemberId: null, name: 'Alan Turing', title: null, email: null, onPeopleList: true },
    { personKey: 'p-3', lfid: null, cdpMemberId: null, name: 'Grace Hopper', title: null, email: null, onPeopleList: true },
  ];
  return {
    ...EMPTY_ORG_TRAINEES_RESPONSE,
    accountId: ORG,
    timeRange: range,
    trainees: people.filter((person) => details.some((d) => d.personKey === person.personKey)),
    details,
    filterOptions: {
      foundations: options(details.map((d) => d.foundationId)),
      projects: options(details.map((d) => d.projectId)),
      courses: options(details.map((d) => d.courseName)),
      levels: options(details.map((d) => d.courseLevel)),
      formats: options(details.map((d) => d.courseFormat)),
    },
  };
}

describe('TraineesComponent — project, course, level and format filters (lfx-self-serve#4916)', () => {
  let fixture: ComponentFixture<TraineesComponent>;

  const el = (): HTMLElement => fixture.nativeElement;
  const stat = (name: string): string => el().querySelector(`[data-testid="org-people-trainees-stat-${name}"] .text-2xl`)?.textContent?.trim() ?? '';
  const listed = (): string[] =>
    [...el().querySelectorAll<HTMLElement>('tbody tr[role="button"]')].map((tr) => tr.getAttribute('data-testid')!.replace('org-people-trainees-row-', ''));
  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;
  const optionValues = (name: 'projectOptions' | 'levelOptions' | 'formatOptions' | 'courseOptions'): string[] =>
    (fixture.componentInstance as unknown as Record<typeof name, () => { value: string }[]>)[name]().map((option) => option.value);

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Dropdown picks reach the table through the 150 ms filter debounce. */
  async function pick(values: Record<string, string>): Promise<void> {
    form().patchValue(values);
    await firstValueFrom(timer(200));
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TraineesComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: TraineesService, useValue: { getTrainees: vi.fn((_orgUid: string, range: OrgLensTimeRange) => of(filterResponseFor(range))) } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();
    await TestBed.inject(Router).navigateByUrl('/?tab=training&range=all');
    fixture = TestBed.createComponent(TraineesComponent);
    await settle();
  });

  it('lists everyone and every course before a pick', () => {
    expect(listed().sort()).toEqual(['p-1', 'p-2', 'p-3']);
    expect(stat('trainees')).toBe('3');
    expect(stat('courses-enrolled')).toBe('4');
    expect(stat('certifications')).toBe('1');
  });

  it.each([
    ['project', { project: 'proj-linux' }, ['p-3'], { trainees: '1', 'courses-enrolled': '1', certifications: '0' }],
    ['project', { project: 'proj-k8s' }, ['p-1', 'p-2'], { trainees: '2', 'courses-enrolled': '3', certifications: '1' }],
    ['level', { level: 'Beginner' }, ['p-1', 'p-2'], { trainees: '2', 'courses-enrolled': '2', certifications: '0' }],
    ['level', { level: 'Intermediate' }, ['p-1'], { trainees: '1', 'courses-enrolled': '1', certifications: '1' }],
    ['format', { format: 'E-Learning' }, ['p-1', 'p-3'], { trainees: '2', 'courses-enrolled': '2', certifications: '0' }],
    ['course name shared by two course ids', { course: 'Kubernetes Basics' }, ['p-1', 'p-2'], { trainees: '2', 'courses-enrolled': '2', certifications: '0' }],
    ['project and level together', { project: 'proj-k8s', level: 'Intermediate' }, ['p-1'], { trainees: '1', 'courses-enrolled': '1', certifications: '1' }],
  ])('narrows the table and the stat cards alike by %s', async (_label, values, people, cards) => {
    await pick(values);

    expect(listed().sort()).toEqual(people);
    expect(stat('trainees')).toBe(String(people.length));
    for (const [card, value] of Object.entries(cards)) {
      expect(stat(card)).toBe(value);
    }
  });

  it('drops certificates while a format is picked and says so', async () => {
    expect(el().querySelector('[data-testid="org-people-trainees-format-note"]')).toBeNull();

    await pick({ format: 'Instructor Led' });

    expect(listed()).toEqual(['p-2']);
    expect(stat('certifications')).toBe('0');
    expect(el().querySelector('[data-testid="org-people-trainees-format-note"]')?.textContent).toContain('enrollments only');
  });

  it('offers only the options with rows in the range, and clears a pick the new range no longer has', async () => {
    expect(optionValues('levelOptions')).toEqual(['', 'Beginner', 'Intermediate']);
    expect(optionValues('courseOptions')).toEqual(['', 'Kubernetes Admin', 'Kubernetes Basics', 'Linux Intro']);
    await pick({ project: 'proj-k8s', level: 'Beginner', format: 'Instructor Led' });

    form().controls['timeRange'].setValue('30d');
    await settle();

    expect(optionValues('projectOptions')).toEqual(['', 'proj-linux']);
    expect(optionValues('levelOptions')).toEqual(['']);
    expect(optionValues('formatOptions')).toEqual(['', 'E-Learning']);
    expect(form().getRawValue()).toMatchObject({ project: '', level: '', format: '' });
    expect(listed()).toEqual(['p-3']);
    expect(stat('trainees')).toBe('1');
  });
});

describe('TraineesComponent — a learner outside the people list (lfx-self-serve#4287)', () => {
  let fixture: ComponentFixture<TraineesComponent>;
  let open: Mock;

  const el = (): HTMLElement => fixture.nativeElement;
  const stat = (name: string): string => el().querySelector(`[data-testid="org-people-trainees-stat-${name}"] .text-2xl`)?.textContent?.trim() ?? '';
  const listed = (): string[] =>
    [...el().querySelectorAll<HTMLElement>('tbody tr[role="button"]')].map((tr) => tr.getAttribute('data-testid')!.replace('org-people-trainees-row-', ''));
  const component = (): { onSort(column: string): void; filterForm: FormGroup } =>
    fixture.componentInstance as unknown as { onSort(column: string): void; filterForm: FormGroup };

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    open = vi.fn();
    const response: OrgTraineesResponse = {
      ...EMPTY_ORG_TRAINEES_RESPONSE,
      accountId: ORG,
      timeRange: '730d',
      trainees: [
        { personKey: 'p-1', lfid: 'lfid-1', cdpMemberId: null, name: 'Ada Lovelace', title: 'Engineer', email: 'ada@example.com', onPeopleList: true },
        // The BFF sends nothing but the name for these learners; the row must not invent or borrow the rest.
        { personKey: 'ti:outside', lfid: null, cdpMemberId: null, name: 'Bea Outside', title: null, email: null, onPeopleList: false },
      ],
      details: [detail('p-1', 'lfs101', 'Enrolled', 'lf'), detail('ti:outside', 'cka', 'Certified', 'cncf'), detail('ti:outside', 'lfs101', 'Enrolled', 'lf')],
    };
    await TestBed.configureTestingModule({
      imports: [TraineesComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: TraineesService, useValue: { getTrainees: vi.fn(() => of(response)) } },
        { provide: PersonDetailDrawerService, useValue: { open } },
      ],
    }).compileComponents();
    await TestBed.inject(Router).navigateByUrl('/?tab=training');
    fixture = TestBed.createComponent(TraineesComponent);
    await settle();
  });

  it('lists the learner with name and training status only, counted in the stat cards', () => {
    const row = el().querySelector<HTMLElement>('[data-testid="org-people-trainees-row-ti:outside"]')!;

    expect(listed().sort()).toEqual(['p-1', 'ti:outside']);
    expect(stat('trainees')).toBe('2');
    expect(stat('certifications')).toBe('1');
    expect(row.textContent).toContain('Bea Outside');
    expect(row.textContent).toContain('Certified');
    expect(row.textContent).toContain('Not on the people list');
    expect(row.textContent).not.toContain('@');
    expect(row.querySelector('button')).toBeNull();
  });

  it('opens no person drawer from the learner, and the row still expands, sorts and searches', async () => {
    el().querySelector<HTMLElement>('[data-testid="org-people-trainees-row-ti:outside-name"]')!.click();
    await settle();

    expect(open).not.toHaveBeenCalled();
    // The click reached the row: it toggled the training details open.
    expect(el().querySelector('[data-testid="org-people-trainees-row-ti:outside-detail-row"]')?.textContent).toContain('Courses & Certifications (2)');

    component().onSort('name');
    await settle();
    expect(listed()).toEqual(['p-1', 'ti:outside']);
    component().onSort('name');
    await settle();
    expect(listed()).toEqual(['ti:outside', 'p-1']);

    component().filterForm.patchValue({ search: 'bea' });
    await firstValueFrom(timer(200));
    await settle();
    expect(listed()).toEqual(['ti:outside']);
    expect(stat('trainees')).toBe('1');
  });
});
