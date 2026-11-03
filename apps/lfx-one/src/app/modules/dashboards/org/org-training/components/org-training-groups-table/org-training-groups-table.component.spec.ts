// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type {
  OrgTrainingGroupBy,
  OrgTrainingGroupEmployeesResponse,
  OrgTrainingGroupRow,
  OrgTrainingGroupsResponse,
  OrgTrainingStatsQuery,
  OrgTrainingTabId,
} from '@lfx-one/shared/interfaces';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrgTrainingGroupsTableComponent } from './org-training-groups-table.component';

const QUERY: OrgTrainingStatsQuery = { range: '730d', foundation: 'f-1', project: null, course: null, level: null, format: null };

const ROW: OrgTrainingGroupRow = {
  key: 'Course One',
  label: 'Course One',
  people: 5,
  coursesTaken: 8,
  completed: 4,
  inProgress: 2,
  level: 'Advanced',
  foundation: 'Foundation One',
  logoUrl: null,
};

const RESPONSE: OrgTrainingGroupsResponse = {
  data: [ROW],
  total: 1,
  totals: { people: 11, coursesTaken: 20, completed: 9, inProgress: 3 },
};

const EMPLOYEES: OrgTrainingGroupEmployeesResponse = {
  groupBy: 'course',
  groupValue: 'Course One',
  label: 'Course One',
  tab: 'certifications',
  status: 'completed',
  total: 4,
  data: [{ contactId: 'person-1', name: 'Sample Person', jobTitle: 'Engineer' }],
};

async function render(tab: OrgTrainingTabId = 'certifications', groupBy: OrgTrainingGroupBy = 'course') {
  const trainingService = {
    getGroups: vi.fn(() => of(RESPONSE)),
    getGroupEmployees: vi.fn(() => of(EMPLOYEES)),
    getTrainingStats: vi.fn(() => of(null)),
  };

  await TestBed.configureTestingModule({
    imports: [OrgTrainingGroupsTableComponent],
    providers: [
      provideNoopAnimations(),
      { provide: OrgLensTrainingService, useValue: trainingService },
      { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgTrainingGroupsTableComponent);
  fixture.componentRef.setInput('orgUid', 'org-1');
  fixture.componentRef.setInput('query', QUERY);
  fixture.componentRef.setInput('groupBy', groupBy);
  fixture.componentRef.setInput('tab', tab);
  await settle(fixture);
  return { fixture, trainingService };
}

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const byTestId = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
const text = (testId: string): string => byTestId(testId)?.textContent?.trim() ?? '';

describe('OrgTrainingGroupsTableComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
  });

  it('groups by Course by default, sorted by Certified descending, from the first page', async () => {
    const { trainingService } = await render();

    expect(trainingService.getGroups).toHaveBeenCalledTimes(1);
    expect(trainingService.getGroups).toHaveBeenCalledWith('org-1', QUERY, {
      groupBy: 'course',
      tab: 'certifications',
      searchQuery: undefined,
      sortField: 'completed',
      sortOrder: 'DESC',
      pageSize: 10,
      offset: 0,
    });
    expect(text('org-training-group-name-Course One')).toBe('Course One');
    expect(text('org-training-group-meta-Course One')).toBe('Foundation One · Advanced');
  });

  it.each<[OrgTrainingGroupBy, string]>([
    ['course', 'Course'],
    ['foundation', 'Foundation'],
    ['project', 'Project'],
    ['level', 'Level'],
    ['format', 'Format'],
  ])('fetches groups for groupBy=%s and labels the first column %s', async (groupBy, label) => {
    const { trainingService } = await render('certifications', groupBy);

    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-1', QUERY, expect.objectContaining({ groupBy, tab: 'certifications' }));
    expect(text('sort-label')).toBe(label);
  });

  it('refetches with the new group-by when it changes', async () => {
    const { fixture, trainingService } = await render();

    fixture.componentRef.setInput('groupBy', 'foundation');
    await settle(fixture);

    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-1', QUERY, expect.objectContaining({ groupBy: 'foundation' }));
  });

  it('splits by product type: Certified on the Certifications tab, Completed on the Trainings tab', async () => {
    const certifications = await render('certifications');
    expect(text('sort-completed')).toBe('Certified');
    expect(certifications.trainingService.getGroups).toHaveBeenCalledWith('org-1', QUERY, expect.objectContaining({ tab: 'certifications' }));
    TestBed.resetTestingModule();
    document.body.innerHTML = '';

    const trainings = await render('trainings');
    expect(text('sort-completed')).toBe('Completed');
    expect(trainings.trainingService.getGroups).toHaveBeenCalledWith('org-1', QUERY, expect.objectContaining({ tab: 'trainings' }));
  });

  it('shows the response totals in the footer and says which tile the completed total equals', async () => {
    await render('certifications');

    expect(text('org-training-groups-totals-people')).toBe('11');
    expect(text('org-training-groups-totals-courses-taken')).toBe('20');
    expect(text('org-training-groups-totals-completed')).toBe('9');
    expect(text('org-training-groups-totals-in-progress')).toBe('3');
    expect(byTestId('org-training-groups-totals-completed')?.getAttribute('aria-label')).toBe('Certified total, equals the Certifications tile');
    expect(byTestId('org-training-groups-totals')?.getAttribute('title')).toContain('equals the “Certifications” tile');
  });

  it('names the Trainings completed tile on the Trainings tab', async () => {
    await render('trainings');

    expect(byTestId('org-training-groups-totals-completed')?.getAttribute('aria-label')).toBe('Completed total, equals the Trainings completed tile');
  });

  it('searches in the table only: refetches the groups with the term and never reads the stats', async () => {
    const { fixture, trainingService } = await render();
    const input = document.querySelector('[data-testid="org-training-search-input"] input') as HTMLInputElement;

    input.value = 'course';
    input.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle(fixture);

    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-1', QUERY, expect.objectContaining({ searchQuery: 'course', offset: 0 }));
    expect(trainingService.getTrainingStats).not.toHaveBeenCalled();
  });

  it('sorts server-side: a new count column starts descending, a repeat click flips the order', async () => {
    const { fixture, trainingService } = await render();

    (document.querySelector('[data-testid="sort-people"] button') as HTMLElement).click();
    await settle(fixture);
    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-1', QUERY, expect.objectContaining({ sortField: 'people', sortOrder: 'DESC' }));

    (document.querySelector('[data-testid="sort-people"] button') as HTMLElement).click();
    await settle(fixture);
    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-1', QUERY, expect.objectContaining({ sortField: 'people', sortOrder: 'ASC' }));

    (document.querySelector('[data-testid="sort-label"] button') as HTMLElement).click();
    await settle(fixture);
    expect(trainingService.getGroups).toHaveBeenLastCalledWith('org-1', QUERY, expect.objectContaining({ sortField: 'label', sortOrder: 'ASC' }));
  });

  it('opens the one drawer from a Certified cell with the pair count and lists current employees', async () => {
    const { fixture, trainingService } = await render();

    (document.querySelector('[data-testid="org-training-group-completed-Course One"] button') as HTMLElement).click();
    await settle(fixture);

    expect(trainingService.getGroupEmployees).toHaveBeenCalledWith('org-1', QUERY, {
      groupBy: 'course',
      groupValue: 'Course One',
      tab: 'certifications',
      status: 'completed',
    });
    expect(text('org-training-group-employees-title')).toContain('Certified');
    expect(text('org-training-group-employees-subtitle')).toContain('4 certified');
    expect(text('org-training-group-employees-note')).toContain('current employees only');
    expect(byTestId('org-training-group-employee-person-1')).not.toBeNull();
  });

  it('opens the in-progress list from the In progress cell', async () => {
    const { fixture, trainingService } = await render('trainings');

    (document.querySelector('[data-testid="org-training-group-in-progress-Course One"] button') as HTMLElement).click();
    await settle(fixture);

    expect(trainingService.getGroupEmployees).toHaveBeenCalledWith('org-1', QUERY, expect.objectContaining({ tab: 'trainings', status: 'in-progress' }));
  });
});
