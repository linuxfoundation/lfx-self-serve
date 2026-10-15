// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChartComponent } from '@components/chart/chart.component';
import type { Account, OrgLensRoiProjectRow } from '@lfx-one/shared/interfaces';
import { formatCurrency } from '@lfx-one/shared/utils';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensRoiService } from '@services/org-lens-roi.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgRoiProjectsDonutComponent } from './org-roi-projects-donut.component';

/** Stands in for the canvas, which jsdom cannot draw. The note and the legend are what is under test. */
@Component({ selector: 'lfx-chart', template: '' })
class ChartStubComponent {
  public readonly type = input<string>();
  public readonly data = input<unknown>();
  public readonly options = input<unknown>();
  public readonly height = input<string>();
}

const ACCOUNT = { accountId: 'acc-1', accountName: 'Test Org', uid: 'acc-1' } as Account;

const project = (projectId: string, projectName: string, totalExpenditure: number, totalReturn: number): OrgLensRoiProjectRow =>
  ({
    projectId,
    projectSlug: projectId,
    projectName,
    totalExpenditure,
    totalReturn,
    profit: totalReturn - totalExpenditure,
    roi: null,
    bcr: null,
    categories: [],
  }) as unknown as OrgLensRoiProjectRow;

/** Two projects make money and two lose it. The losses total -$350 and are reported in the note, not listed. */
const MIXED = [
  project('prj-alpha', 'Alpha', 1000, 5000),
  project('prj-beta', 'Beta', 500, 800),
  project('prj-gamma', 'Gamma', 200, 50),
  project('prj-delta', 'Delta', 500, 300),
];

/** Every project loses money, so there is no positive magnitude to draw. */
const ALL_LOSSES = [project('prj-gamma', 'Gamma', 200, 50), project('prj-delta', 'Delta', 500, 300)];

describe('OrgRoiProjectsDonutComponent — net return disclosure', () => {
  let rows: OrgLensRoiProjectRow[];

  beforeEach(async () => {
    rows = [];
    TestBed.overrideComponent(OrgRoiProjectsDonutComponent, {
      remove: { imports: [ChartComponent] },
      add: { imports: [ChartStubComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [OrgRoiProjectsDonutComponent],
      providers: [
        { provide: AccountContextService, useValue: { selectedAccount: signal(ACCOUNT) } },
        { provide: OrgLensRoiService, useValue: { getProjects: vi.fn(() => of({ method: 'logit', rows })) } },
      ],
    }).compileComponents();
  });

  const openNetReturn = (): ComponentFixture<OrgRoiProjectsDonutComponent> => {
    const fixture = TestBed.createComponent(OrgRoiProjectsDonutComponent);
    fixture.componentRef.setInput('method', 'logit');
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="org-roi-projects-donut-measure-netReturn"]').click();
    fixture.detectChanges();
    return fixture;
  };
  const has = (fixture: ComponentFixture<OrgRoiProjectsDonutComponent>, testId: string): boolean =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) !== null;
  const text = (fixture: ComponentFixture<OrgRoiProjectsDonutComponent>, testId: string): string =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';

  it('states the loss total in the note and lists no losing project beside the chart', () => {
    rows = MIXED;
    const fixture = openNetReturn();

    expect(text(fixture, 'org-roi-projects-donut-negative-note')).toContain('2 projects have a negative net return');
    expect(text(fixture, 'org-roi-projects-donut-negative-note')).toContain(formatCurrency(-350));
    expect(has(fixture, 'org-roi-projects-donut-negative-list')).toBe(false);
    expect(text(fixture, 'org-roi-projects-donut-legend')).toContain('Alpha');
    expect(text(fixture, 'org-roi-projects-donut-legend')).not.toContain('Gamma');
    expect(text(fixture, 'org-roi-projects-donut-legend')).not.toContain('Delta');
  });

  it('keeps the total and draws no chart when no project has a positive net return', () => {
    rows = ALL_LOSSES;
    const fixture = openNetReturn();

    expect(has(fixture, 'org-roi-projects-donut-no-positive')).toBe(true);
    expect(has(fixture, 'org-roi-projects-donut-chart')).toBe(false);
    expect(text(fixture, 'org-roi-projects-donut-negative-note')).toContain('2 projects have a negative net return');
    expect(text(fixture, 'org-roi-projects-donut-negative-note')).toContain(formatCurrency(-350));
  });
});
