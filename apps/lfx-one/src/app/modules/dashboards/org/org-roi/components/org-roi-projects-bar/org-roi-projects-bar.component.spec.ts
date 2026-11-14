// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChartComponent } from '@components/chart/chart.component';
import type { OrgLensRoiProjectRow } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { OrgRoiProjectsBarComponent } from './org-roi-projects-bar.component';

/** Stands in for the canvas, which jsdom cannot draw. What the component hands the chart is what is under test. */
@Component({ selector: 'lfx-chart', template: '' })
class ChartStubComponent {
  public readonly type = input<string>();
  public readonly data = input<{ datasets: { stack?: string }[] }>();
  public readonly options = input<unknown>();
  public readonly height = input<string>();
}

const PROJECTS = [
  {
    projectId: 'prj-alpha',
    projectSlug: 'alpha',
    projectName: 'Alpha',
    totalExpenditure: 1000,
    totalReturn: 5000,
    profit: 4000,
    roi: 4,
    bcr: 5,
    categories: [
      { type: 'code', label: 'Code Contribution', expenditure: 700 },
      { type: 'community', label: 'Community Contribution', expenditure: 300 },
    ],
  },
  {
    projectId: 'prj-beta',
    projectSlug: 'beta',
    projectName: 'Beta',
    totalExpenditure: 500,
    totalReturn: 800,
    profit: 300,
    roi: 0.6,
    bcr: 1.6,
    categories: [{ type: 'code', label: 'Code Contribution', expenditure: 500 }],
  },
] as unknown as OrgLensRoiProjectRow[];

describe('OrgRoiProjectsBarComponent — series toggles', () => {
  let fixture: ComponentFixture<OrgRoiProjectsBarComponent>;

  // Let each form control's value and disabled state reach the rendered checkbox before asserting.
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const toggle = (series: 'investment' | 'return'): HTMLInputElement =>
    fixture.nativeElement.querySelector(`[data-testid="org-roi-projects-bar-series-${series}"] input[type="checkbox"]`);
  const hint = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="org-roi-projects-bar-series-hint"]');
  const chartLabel = (): string => fixture.nativeElement.querySelector('[data-testid="org-roi-projects-bar-chart"]').getAttribute('aria-label');
  const drawnStacks = (): string[] =>
    fixture.debugElement
      .query(By.directive(ChartStubComponent))
      .componentInstance.data()
      .datasets.map((dataset: { stack?: string }) => dataset.stack ?? '');

  beforeEach(async () => {
    TestBed.overrideComponent(OrgRoiProjectsBarComponent, {
      remove: { imports: [ChartComponent] },
      add: { imports: [ChartStubComponent] },
    });
    await TestBed.configureTestingModule({ imports: [OrgRoiProjectsBarComponent] }).compileComponents();
    fixture = TestBed.createComponent(OrgRoiProjectsBarComponent);
    fixture.componentRef.setInput('projects', PROJECTS);
    await settle();
  });

  it('draws both series with both checkboxes on by default', () => {
    expect(toggle('investment').checked).toBe(true);
    expect(toggle('return').checked).toBe(true);
    expect(hint()).toBeNull();
    expect(drawnStacks()).toContain('investment');
    expect(drawnStacks()).toContain('return');
    expect(chartLabel()).toContain('comparing modelled investment');
  });

  it('hides investment bars and locks return on, so the chart always draws a series', async () => {
    toggle('investment').click();
    await settle();

    expect(toggle('investment').checked).toBe(false);
    expect(toggle('return').disabled).toBe(true);
    expect(hint()).not.toBeNull();
    expect(drawnStacks()).not.toContain('investment');
    expect(drawnStacks()).toContain('return');
    expect(chartLabel()).toContain('Horizontal bar chart of return');
  });

  it('hides return bars and locks investment on, the mirror case', async () => {
    toggle('return').click();
    await settle();

    expect(toggle('return').checked).toBe(false);
    expect(toggle('investment').disabled).toBe(true);
    expect(drawnStacks()).not.toContain('return');
    expect(chartLabel()).toContain('Horizontal bar chart of modelled investment');
  });

  it('does not let the remaining series be cleared', async () => {
    toggle('investment').click();
    await settle();

    toggle('return').click();
    await settle();

    expect(toggle('return').checked).toBe(true);
    expect(drawnStacks()).toContain('return');
  });

  it('restores both series when the hidden one is turned back on', async () => {
    toggle('investment').click();
    await settle();
    toggle('investment').click();
    await settle();

    expect(toggle('return').disabled).toBe(false);
    expect(hint()).toBeNull();
    expect(drawnStacks()).toContain('investment');
    expect(chartLabel()).toContain('comparing modelled investment');
  });
});
