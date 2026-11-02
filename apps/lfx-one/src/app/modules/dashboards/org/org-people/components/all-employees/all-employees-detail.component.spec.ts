// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ORG_CODE_MEASURE_DEFINITION, ORG_CODE_METRIC_LABEL, ORG_COMMITS_DEFINITION } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeCodeContribution, OrgAllEmployeeDetail, OrgPersonCodeView } from '@lfx-one/shared/interfaces';
import { Tooltip } from 'primeng/tooltip';
import { describe, expect, it } from 'vitest';

import { AllEmployeesDetailComponent } from './all-employees-detail.component';

function project(projectId: string, commits: number): OrgAllEmployeeCodeContribution {
  return {
    projectId,
    projectName: projectId,
    foundationId: 'foundation-1',
    foundationName: 'Foundation One',
    commits,
    lastActivityDate: null,
    isMaintainer: false,
  };
}

describe('AllEmployeesDetailComponent', () => {
  it("shows each project's own distinct commits, a mirrored commit counting in every project", async () => {
    // 3 commits only in project-1 and 4 mirrored in project-1 and project-2: 7 distinct commits.
    const detail: OrgAllEmployeeDetail = {
      personKey: 'p-1',
      boardSeats: [],
      committeeSeats: [],
      code: [project('project-1', 7), project('project-2', 4)],
      totalCommits: 7,
      events: [],
      training: [],
    };
    await TestBed.configureTestingModule({ imports: [AllEmployeesDetailComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AllEmployeesDetailComponent);
    fixture.componentRef.setInput('detail', detail);
    fixture.detectChanges();
    await fixture.whenStable();

    const cells = (projectId: string): string[] =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll(`[data-testid="org-people-all-employees-detail-code-${projectId}"] td`)].map(
        (cell) => cell.textContent?.trim() ?? ''
      );
    expect(cells('project-1')).toContain('7');
    expect(cells('project-2')).toContain('4');
  });

  it.each([
    { flagged: true, role: '—' },
    { flagged: false, role: 'Contributor' },
  ])('shows the role as $role when maintainer roles unavailable is $flagged', async ({ flagged, role }) => {
    const detail: OrgAllEmployeeDetail = {
      personKey: 'p-1',
      boardSeats: [],
      committeeSeats: [],
      code: [project('project-1', 1)],
      totalCommits: 1,
      events: [],
      training: [],
      ...(flagged ? { maintainerRolesUnavailable: true as const } : {}),
    };
    await TestBed.configureTestingModule({ imports: [AllEmployeesDetailComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AllEmployeesDetailComponent);
    fixture.componentRef.setInput('detail', detail);
    fixture.detectChanges();
    await fixture.whenStable();

    const cells = [...(fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="org-people-all-employees-detail-code-project-1"] td')].map(
      (cell) => cell.textContent?.trim() ?? ''
    );
    expect(cells[2]).toBe(role);
  });

  it.each([
    { label: 'without a view', view: undefined, header: ORG_CODE_METRIC_LABEL.commits, tooltip: ORG_COMMITS_DEFINITION },
    {
      label: 'with All code contributions',
      view: { range: '90d', projectScope: 'lf', commitScope: 'all', metric: 'code' } as OrgPersonCodeView,
      header: ORG_CODE_METRIC_LABEL.code,
      tooltip: ORG_CODE_MEASURE_DEFINITION.code,
    },
    {
      label: 'with Only main branch commits',
      view: { range: '365d', projectScope: 'all', commitScope: 'merged', metric: 'commits' } as OrgPersonCodeView,
      header: ORG_CODE_METRIC_LABEL.commits,
      tooltip: ORG_CODE_MEASURE_DEFINITION.merged,
    },
  ])('names the code column after the code count the row shows ($label, lfx-self-serve#4404)', async ({ view, header, tooltip }) => {
    const detail: OrgAllEmployeeDetail = {
      personKey: 'p-1',
      boardSeats: [],
      committeeSeats: [],
      code: [project('project-1', 3)],
      totalCommits: 3,
      ...(view ? { codeView: view } : {}),
      events: [],
      training: [],
    };
    await TestBed.configureTestingModule({ imports: [AllEmployeesDetailComponent] }).compileComponents();
    const fixture = TestBed.createComponent(AllEmployeesDetailComponent);
    fixture.componentRef.setInput('detail', detail);
    fixture.detectChanges();
    await fixture.whenStable();

    const headerText = (fixture.nativeElement as HTMLElement)
      .querySelector('[data-testid="org-people-all-employees-detail-commits-header"]')
      ?.textContent?.trim();
    expect(headerText).toBe(header);
    const info = fixture.debugElement.query(By.css('[data-testid="org-people-all-employees-detail-commits-info"]'));
    expect(info.injector.get(Tooltip).content).toBe(tooltip);
  });
});
