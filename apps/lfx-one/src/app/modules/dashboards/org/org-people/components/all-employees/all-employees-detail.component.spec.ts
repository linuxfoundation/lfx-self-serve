// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import type { OrgAllEmployeeCodeContribution, OrgAllEmployeeDetail } from '@lfx-one/shared/interfaces';
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
});
