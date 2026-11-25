// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAX_ORG_TRAINING_GROUP_EMPLOYEES, ORG_TRAINING_ROLL_UP_TOTALS_NOTE } from '@lfx-one/shared/constants';
import type {
  OrgTrainingGroupBy,
  OrgTrainingGroupEmployeesResponse,
  OrgTrainingGroupRow,
  OrgTrainingGroupsResponse,
  OrgTrainingStatsQuery,
  OrgTrainingTabId,
} from '@lfx-one/shared/interfaces';
import { OrgLensTrainingService } from '@shared/services/org-lens-training.service';
import { OrgLensViewModeService } from '@shared/services/org-lens-view-mode.service';
import { PersonDetailDrawerService } from '@shared/services/person-detail-drawer.service';
import { signal } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
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

async function render(
  tab: OrgTrainingTabId = 'certifications',
  groupBy: OrgTrainingGroupBy = 'course',
  response: OrgTrainingGroupsResponse = RESPONSE,
  employeeView = false
) {
  const drawerOpen = vi.fn();
  const trainingService = {
    getGroups: vi.fn(() => of(response)),
    getGroupEmployees: vi.fn(() => of(EMPLOYEES)),
    getTrainingStats: vi.fn(() => of(null)),
  };

  await TestBed.configureTestingModule({
    imports: [OrgTrainingGroupsTableComponent],
    providers: [
      provideNoopAnimations(),
      { provide: OrgLensTrainingService, useValue: trainingService },
      { provide: PersonDetailDrawerService, useValue: { open: drawerOpen } },
      { provide: OrgLensViewModeService, useValue: { isEmployeeView: signal(employeeView) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(OrgTrainingGroupsTableComponent);
  fixture.componentRef.setInput('orgUid', 'org-1');
  fixture.componentRef.setInput('query', QUERY);
  fixture.componentRef.setInput('groupBy', groupBy);
  fixture.componentRef.setInput('tab', tab);
  await settle(fixture);
  return { fixture, trainingService, drawerOpen };
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
    expect(byTestId('org-training-groups-totals-completed')?.getAttribute('aria-label')).toBe('Certified total 9, equals the Certifications tile');
    expect(byTestId('org-training-groups-totals')?.getAttribute('title')).toContain('equals the “Certifications” tile');
  });

  it('names the Trainings completed tile on the Trainings tab', async () => {
    await render('trainings');

    expect(byTestId('org-training-groups-totals-completed')?.getAttribute('aria-label')).toBe('Completed total 9, equals the Trainings completed tile');
  });

  describe('while the next view loads', () => {
    const NEXT: OrgTrainingGroupsResponse = { data: [ROW], total: 1, totals: { people: 7, coursesTaken: 12, completed: 5, inProgress: 1 } };

    it.each([
      ['the range or filters change', 'query', { ...QUERY, range: '90d' }],
      ['the company switches', 'orgUid', 'org-2'],
    ])('hides the previous totals, the scope note and the tile text when %s, and shows the new ones once they arrive', async (_name, input, value) => {
      const { fixture, trainingService } = await render('certifications');
      expect(text('org-training-groups-totals-courses-taken')).toBe('20');
      const pending = new Subject<OrgTrainingGroupsResponse>();
      trainingService.getGroups.mockReturnValue(pending);

      fixture.componentRef.setInput(input, value);
      await settle(fixture);

      expect(trainingService.getGroups).toHaveBeenCalledTimes(2);
      expect(byTestId('org-training-groups-totals')).toBeNull();
      expect(byTestId('org-training-groups-totals-courses-taken')).toBeNull();
      expect(byTestId('org-training-groups-scope-note')).toBeNull();
      expect(document.body.textContent).not.toContain('equals the');

      pending.next(NEXT);
      pending.complete();
      await settle(fixture);

      expect(text('org-training-groups-totals-people')).toBe('7');
      expect(text('org-training-groups-totals-courses-taken')).toBe('12');
      expect(text('org-training-groups-totals-completed')).toBe('5');
      expect(byTestId('org-training-groups-scope-note')).not.toBeNull();
      expect(byTestId('org-training-groups-totals')?.getAttribute('title')).toContain('equals the “Certifications” tile');
    });
  });

  it('narrows the groups by the page search term and never reads the stats', async () => {
    const { fixture, trainingService } = await render();

    fixture.componentRef.setInput('searchQuery', 'course');
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

  it('states under the totals row what the Certifications tab counts and how it adds up to the in-progress tile', async () => {
    await render('certifications');

    expect(text('org-training-groups-scope-note')).toBe(
      'This tab counts Certification products only, so its In progress total can differ from the Courses in progress tile; the Trainings tab holds the rest, and the two tabs add up to the tile.'
    );
  });

  it('states under the totals row what the Trainings tab counts and how it adds up to the in-progress tile', async () => {
    await render('trainings');

    expect(text('org-training-groups-scope-note')).toBe(
      'This tab counts all non-Certification products, so its In progress total can differ from the Courses in progress tile; the Certifications tab holds the rest, and the two tabs add up to the tile.'
    );
  });

  it('shows no scope note when there is no totals row', async () => {
    await render('certifications', 'course', { data: [ROW], total: 1, totals: { people: 0, coursesTaken: 0, completed: 0, inProgress: 0 } });

    expect(byTestId('org-training-groups-scope-note')).toBeNull();
  });

  it('gates the totals footer on the response totals, not on the searched row total', async () => {
    await render('certifications', 'course', { data: [], total: 0, totals: { people: 11, coursesTaken: 20, completed: 9, inProgress: 3 } });
    expect(byTestId('org-training-groups-totals')).not.toBeNull();
    TestBed.resetTestingModule();
    document.body.innerHTML = '';

    await render('certifications', 'course', { data: [ROW], total: 1, totals: { people: 0, coursesTaken: 0, completed: 0, inProgress: 0 } });
    expect(byTestId('org-training-groups-totals')).toBeNull();
  });

  it('names value, status and row on the count buttons', async () => {
    await render();

    expect(byTestId('org-training-group-completed-button-Course One')?.getAttribute('aria-label')).toBe('4 certified, Course One. Show people');
    expect(byTestId('org-training-group-in-progress-button-Course One')?.getAttribute('aria-label')).toBe('2 in progress, Course One. Show people');
  });

  it('shows the foundation under a project row and nothing under other groupings', async () => {
    await render('certifications', 'project');
    expect(text('org-training-group-meta-Course One')).toBe('Foundation One');
    TestBed.resetTestingModule();
    document.body.innerHTML = '';

    await render('certifications', 'level');
    expect(byTestId('org-training-group-meta-Course One')).toBeNull();
  });

  it('states a failed groups read with a Retry that refetches, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture, trainingService } = await render();
    trainingService.getGroups.mockReturnValueOnce(throwError(() => new Error('down')));
    fixture.componentRef.setInput('searchQuery', 'x');
    await settle(fixture);

    expect(byTestId('org-training-groups-error')).not.toBeNull();
    expect(byTestId('org-training-groups-error')?.getAttribute('role')).toBe('alert');
    expect(error).toHaveBeenCalled();

    (document.querySelector('[data-testid="org-training-groups-retry"] button') as HTMLElement).click();
    await settle(fixture);

    expect(byTestId('org-training-groups-error')).toBeNull();
    expect(trainingService.getGroups).toHaveBeenCalledTimes(3);
    error.mockRestore();
  });

  it('keeps the clicked count and offers Retry when the employees fetch fails, never reading it as zero data', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fixture, trainingService } = await render();
    trainingService.getGroupEmployees.mockReturnValueOnce(throwError(() => new Error('down')));

    (document.querySelector('[data-testid="org-training-group-completed-Course One"] button') as HTMLElement).click();
    await settle(fixture);

    expect(byTestId('org-training-group-employees-error')).not.toBeNull();
    expect(text('org-training-group-employees-subtitle')).toContain('4 certified');
    expect(document.body.textContent).not.toContain('No current employees found');
    expect(error).toHaveBeenCalled();

    (document.querySelector('[data-testid="org-training-group-employees-retry"] button') as HTMLElement).click();
    await settle(fixture);

    expect(byTestId('org-training-group-employees-error')).toBeNull();
    expect(byTestId('org-training-group-employee-person-1')).not.toBeNull();
    expect(trainingService.getGroupEmployees).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  describe('when the roster hits the server cap', () => {
    const capped = (): OrgTrainingGroupEmployeesResponse => ({
      ...EMPLOYEES,
      total: MAX_ORG_TRAINING_GROUP_EMPLOYEES + 40,
      data: Array.from({ length: MAX_ORG_TRAINING_GROUP_EMPLOYEES }, (_, index) => ({ contactId: `p-${index}`, name: `Person ${index}`, jobTitle: null })),
    });

    async function openCapped() {
      const view = await render();
      view.trainingService.getGroupEmployees.mockReturnValue(of(capped()));
      (document.querySelector('[data-testid="org-training-group-completed-Course One"] button') as HTMLElement).click();
      await settle(view.fixture);
      return view;
    }

    const search = async (fixture: ComponentFixture<unknown>, term: string) => {
      const input = document.querySelector('[data-test="org-training-group-employees-search"]') as HTMLInputElement;
      input.value = term;
      input.dispatchEvent(new Event('input'));
      await settle(fixture);
    };

    it('states the cap above the list, and keeps it while a search narrows the rows', async () => {
      const { fixture } = await openCapped();
      expect(text('org-training-group-employees-cap-note')).toContain(`first ${MAX_ORG_TRAINING_GROUP_EMPLOYEES}`);

      await search(fixture, 'Person 12');

      expect(byTestId('org-training-group-employee-p-12')).not.toBeNull();
      expect(byTestId('org-training-group-employees-cap-note')).not.toBeNull();
    });

    it('qualifies the no-match message: only the loaded employees were searched', async () => {
      const { fixture } = await openCapped();

      await search(fixture, 'nobody-by-this-name');

      expect(byTestId('org-training-group-employees-list')).toBeNull();
      expect(byTestId('org-training-group-employees-cap-note')).not.toBeNull();
      expect(document.body.textContent).toContain('No loaded employees match your search');
      expect(document.body.textContent).toContain(`first ${MAX_ORG_TRAINING_GROUP_EMPLOYEES}`);
    });

    it('keeps the plain no-match message for a roster below the cap', async () => {
      const { fixture } = await render();
      (document.querySelector('[data-testid="org-training-group-completed-Course One"] button') as HTMLElement).click();
      await settle(fixture);

      await search(fixture, 'nobody-by-this-name');

      expect(byTestId('org-training-group-employees-cap-note')).toBeNull();
      expect(document.body.textContent).toContain('No employees match your search.');
    });
  });

  it('opens the person drawer on the training tab with the current range', async () => {
    const { fixture, drawerOpen } = await render();
    (document.querySelector('[data-testid="org-training-group-completed-Course One"] button') as HTMLElement).click();
    await settle(fixture);

    (byTestId('org-training-group-employee-person-person-1') as HTMLElement).click();

    expect(drawerOpen).toHaveBeenCalledWith(expect.objectContaining({ personKey: 'person-1', defaultTab: 'training', range: QUERY.range }));
  });

  it('closes the drawer when the organization changes', async () => {
    const { fixture } = await render();
    (document.querySelector('[data-testid="org-training-group-completed-Course One"] button') as HTMLElement).click();
    await settle(fixture);
    expect(byTestId('org-training-group-employees-title')).not.toBeNull();

    fixture.componentRef.setInput('orgUid', 'org-2');
    await settle(fixture);

    expect(byTestId('org-training-group-employees-title')).toBeNull();
  });

  it('shows no Company column and no roll-up totals note on a single organization', async () => {
    await render();

    expect(byTestId('org-training-groups-company-header')).toBeNull();
    expect(byTestId('org-training-group-company-Course One')).toBeNull();
    expect(byTestId('org-training-groups-roll-up-totals-note')).toBeNull();
    expect(byTestId('org-training-groups-totals')?.getAttribute('title')).not.toContain(ORG_TRAINING_ROLL_UP_TOTALS_NOTE);
  });

  describe('in a family roll-up', () => {
    const ACME = { accountId: '001000000000000AAA', name: 'Acme' };
    const ACME_LABS = { accountId: '001000000000000BBB', name: 'Acme Labs' };
    const ROLL_UP_RESPONSE: OrgTrainingGroupsResponse = {
      data: [
        { ...ROW, organization: ACME },
        { ...ROW, completed: 1, inProgress: 0, organization: ACME_LABS },
      ],
      total: 2,
      totals: { people: 5, coursesTaken: 9, completed: 4, inProgress: 2 },
    };
    const acmeRow = `Course One::${ACME.accountId}`;
    const labsRow = `Course One::${ACME_LABS.accountId}`;

    async function renderRollUp(company: string | null = '') {
      const drawerOpen = vi.fn();
      const trainingService = {
        getGroups: vi.fn(() => of(ROLL_UP_RESPONSE)),
        getGroupEmployees: vi.fn(() => of(EMPLOYEES)),
        getTrainingStats: vi.fn(() => of(null)),
      };
      await TestBed.configureTestingModule({
        imports: [OrgTrainingGroupsTableComponent],
        providers: [
          provideNoopAnimations(),
          { provide: OrgLensTrainingService, useValue: trainingService },
          { provide: PersonDetailDrawerService, useValue: { open: drawerOpen } },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(OrgTrainingGroupsTableComponent);
      fixture.componentRef.setInput('orgUid', 'family-001000000000000AAA');
      fixture.componentRef.setInput('rollUp', true);
      fixture.componentRef.setInput('company', company);
      fixture.componentRef.setInput('query', QUERY);
      fixture.componentRef.setInput('groupBy', 'course');
      fixture.componentRef.setInput('tab', 'certifications');
      await settle(fixture);
      return { fixture, trainingService, drawerOpen };
    }

    it('shows one row per group value and company, with a Company column', async () => {
      await renderRollUp();

      expect(text('org-training-groups-company-header')).toBe('Company');
      expect(text(`org-training-group-company-${acmeRow}`)).toBe('Acme');
      expect(text(`org-training-group-company-${labsRow}`)).toBe('Acme Labs');
      expect(text(`org-training-group-completed-${labsRow}`)).toBe('1');
      expect(byTestId(`org-training-group-completed-button-${acmeRow}`)?.getAttribute('aria-label')).toBe('4 certified, Course One, Acme. Show people');
    });

    it('notes under the totals row that a person in more than one company is counted once', async () => {
      await renderRollUp();

      expect(text('org-training-groups-roll-up-totals-note')).toBe('A person in more than one company is counted once in the totals.');
      expect(byTestId('org-training-groups-totals')?.getAttribute('title')).toContain(ORG_TRAINING_ROLL_UP_TOTALS_NOTE);
      expect(text('org-training-groups-totals-people')).toBe('5');
    });

    it('reads every organization of the roll-up when no company is picked, and only the picked one otherwise', async () => {
      const { fixture, trainingService } = await renderRollUp();
      expect(trainingService.getGroups).toHaveBeenLastCalledWith(
        'family-001000000000000AAA',
        QUERY,
        expect.not.objectContaining({ company: expect.anything() })
      );

      fixture.componentRef.setInput('company', ACME_LABS.accountId);
      await settle(fixture);

      expect(trainingService.getGroups).toHaveBeenLastCalledWith(
        'family-001000000000000AAA',
        QUERY,
        expect.objectContaining({ company: ACME_LABS.accountId, offset: 0 })
      );
    });

    it('reads nothing while the page cannot check the picked company yet', async () => {
      const { trainingService } = await renderRollUp(null);

      expect(trainingService.getGroups).not.toHaveBeenCalled();
      expect(byTestId('org-training-groups-empty-title')).toBeNull();
    });

    it("opens the drawer for the row's company and names it", async () => {
      const { fixture, trainingService } = await renderRollUp();

      (document.querySelector(`[data-testid="org-training-group-completed-${labsRow}"] button`) as HTMLElement).click();
      await settle(fixture);

      expect(trainingService.getGroupEmployees).toHaveBeenCalledWith('family-001000000000000AAA', QUERY, {
        groupBy: 'course',
        groupValue: 'Course One',
        tab: 'certifications',
        status: 'completed',
        company: ACME_LABS,
      });
      expect(text('org-training-group-employees-subtitle')).toContain('Course One');
      expect(text('org-training-group-employees-subtitle')).toContain('Acme Labs');
    });

    it("opens a person under the row's company", async () => {
      const { fixture, drawerOpen } = await renderRollUp();
      (document.querySelector(`[data-testid="org-training-group-completed-${acmeRow}"] button`) as HTMLElement).click();
      await settle(fixture);

      (byTestId('org-training-group-employee-person-person-1') as HTMLElement).click();

      expect(drawerOpen).toHaveBeenCalledWith(expect.objectContaining({ personKey: 'person-1', organization: ACME }));
    });

    it('states a failed read as an error, never as zeros', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { fixture, trainingService } = await renderRollUp();
      trainingService.getGroups.mockReturnValueOnce(throwError(() => new Error('down')));

      fixture.componentRef.setInput('company', ACME.accountId);
      await settle(fixture);

      expect(byTestId('org-training-groups-error')).not.toBeNull();
      expect(byTestId('org-training-groups-totals')).toBeNull();
      error.mockRestore();
    });
  });
});

describe('OrgTrainingGroupsTableComponent in the all employee view', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = '';
  });

  it('shows the counts as plain numbers: no drill-down button, no learner drawer, no learner request', async () => {
    const { trainingService } = await render('certifications', 'course', RESPONSE, true);

    expect(text('org-training-group-completed-Course One')).toBe('4');
    expect(text('org-training-group-in-progress-Course One')).toBe('2');
    expect(byTestId('org-training-group-completed-button-Course One')).toBeNull();
    expect(byTestId('org-training-group-in-progress-button-Course One')).toBeNull();
    expect(document.querySelector('lfx-org-training-group-employees-drawer')).toBeNull();
    expect(trainingService.getGroupEmployees).not.toHaveBeenCalled();
  });
});
