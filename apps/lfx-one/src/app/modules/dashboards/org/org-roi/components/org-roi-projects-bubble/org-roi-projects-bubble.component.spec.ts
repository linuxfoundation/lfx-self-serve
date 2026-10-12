// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from '@components/chart/chart.component';
import type { OrgLensRoiProjectRow } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgRoiProjectsBubbleComponent } from './org-roi-projects-bubble.component';

interface BubbleChartOptionsStub {
  scales: { x: { min?: number; max?: number }; y: { min?: number; max?: number } };
  plugins: {
    legend: { display: boolean; labels: { filter: (item: { datasetIndex: number }) => boolean } };
    tooltip: { filter: (item: { datasetIndex: number }) => boolean };
  };
}

/** Stands in for the canvas, which jsdom cannot draw. What the component hands the chart is what is under test. */
@Component({ selector: 'lfx-chart', template: '' })
class ChartStubComponent {
  public readonly type = input<string>();
  public readonly data = input<{ datasets: { type?: string; data: unknown[] }[] }>();
  public readonly options = input<BubbleChartOptionsStub>();
  public readonly height = input<string>();
}

const project = (projectId: string, projectName: string, totalExpenditure: number, totalReturn: number): OrgLensRoiProjectRow =>
  ({
    projectId,
    projectSlug: projectId,
    projectName,
    totalExpenditure,
    totalReturn,
    profit: totalReturn - totalExpenditure,
    roi: (totalReturn - totalExpenditure) / totalExpenditure,
    bcr: totalReturn / totalExpenditure,
    categories: [],
  }) as unknown as OrgLensRoiProjectRow;

/** A profitable and a losing project: the line spans every plotted value, $50,000 to $600,000,000. */
const MIXED = [project('prj-kubernetes', 'Kubernetes', 15_000_000, 600_000_000), project('prj-sunset', 'Sunset Tooling', 200_000, 50_000)];

/**
 * Every return exceeds every investment, as in the default top-five selection. Clipped to the
 * bubbles, the diagonal missed this box entirely and no line was drawn.
 */
const ALL_PROFITABLE = [project('prj-kubernetes', 'Kubernetes', 15_000_000, 600_000_000), project('prj-orchard', 'Orchard', 1_600_000, 18_000_000)];

/** One project exactly at break-even: a single plotted value, padded a decade each way. */
const AT_BREAK_EVEN = [project('prj-even', 'Even', 1_000_000, 1_000_000)];

describe('OrgRoiProjectsBubbleComponent — break-even line', () => {
  let fixture: ComponentFixture<OrgRoiProjectsBubbleComponent>;

  const render = (projects: OrgLensRoiProjectRow[]): void => {
    fixture = TestBed.createComponent(OrgRoiProjectsBubbleComponent);
    fixture.componentRef.setInput('projects', projects);
    fixture.detectChanges();
  };
  const chart = (): ChartStubComponent => fixture.debugElement.query(By.directive(ChartStubComponent)).componentInstance;
  const chartLabel = (): string => fixture.nativeElement.querySelector('[data-testid="org-roi-projects-bubble-chart"]').getAttribute('aria-label');
  const note = (): string => fixture.nativeElement.querySelector('[data-testid="org-roi-projects-bubble-breakeven-note"]').textContent;

  beforeEach(async () => {
    TestBed.overrideComponent(OrgRoiProjectsBubbleComponent, {
      remove: { imports: [ChartComponent] },
      add: { imports: [ChartStubComponent] },
    });
    await TestBed.configureTestingModule({ imports: [OrgRoiProjectsBubbleComponent] }).compileComponents();
  });

  it('draws the line across every plotted value, and names it in the legend', () => {
    render(MIXED);

    const datasets = chart().data()!.datasets;
    expect(datasets).toHaveLength(2);
    expect(datasets[1].type).toBe('line');
    expect(datasets[1].data).toEqual([
      { x: 50_000, y: 50_000 },
      { x: 600_000_000, y: 600_000_000 },
    ]);

    const { plugins, scales } = chart().options()!;
    // Pinned rather than autoscaled, so hiding the line from the legend cannot move the bubbles.
    expect(scales.x).toMatchObject({ min: 50_000, max: 600_000_000 });
    expect(scales.y).toMatchObject({ min: 50_000, max: 600_000_000 });
    expect(plugins.legend.display).toBe(true);
    expect(plugins.legend.labels.filter({ datasetIndex: 1 })).toBe(true);
    expect(plugins.legend.labels.filter({ datasetIndex: 0 })).toBe(false);
    // Hovering the line must not open a project tooltip for it.
    expect(plugins.tooltip.filter({ datasetIndex: 1 })).toBe(false);
    expect(plugins.tooltip.filter({ datasetIndex: 0 })).toBe(true);

    expect(chartLabel()).toContain('A dashed line marks break-even, where investment equals return');
    expect(note()).toContain('break-even, where investment equals return');
  });

  it('still draws the line when every return exceeds every investment', () => {
    render(ALL_PROFITABLE);

    expect(chart().data()!.datasets[1].data).toEqual([
      { x: 1_600_000, y: 1_600_000 },
      { x: 600_000_000, y: 600_000_000 },
    ]);
    expect(chart().options()!.plugins.legend.display).toBe(true);
    expect(chartLabel()).toContain('A dashed line marks break-even');
  });

  it('gives the line length when every plotted value is the same', () => {
    render(AT_BREAK_EVEN);

    expect(chart().data()!.datasets[1].data).toEqual([
      { x: 100_000, y: 100_000 },
      { x: 10_000_000, y: 10_000_000 },
    ]);
  });
});
