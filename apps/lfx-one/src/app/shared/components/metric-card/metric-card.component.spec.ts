// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChartComponent } from '@components/chart/chart.component';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MetricCardComponent } from './metric-card.component';

// The chart needs a canvas, which jsdom lacks; the header under test does not depend on it.
@Component({ selector: 'lfx-chart', template: '' })
class ChartStubComponent {
  public readonly type = input<unknown>();
  public readonly data = input<unknown>();
  public readonly options = input<unknown>();
  public readonly height = input<string>();
}

@Component({
  selector: 'lfx-metric-card-test-host',
  imports: [MetricCardComponent],
  template: `<lfx-metric-card title="Active Contributors" chartType="bar" [infoTooltip]="info()" [chartCaption]="caption()" value="876" />`,
})
class HostComponent {
  public readonly info = signal<string | undefined>(undefined);
  public readonly caption = signal<string | undefined>(undefined);
}

@Component({
  selector: 'lfx-metric-card-stat-only-host',
  imports: [MetricCardComponent],
  template: `<lfx-metric-card title="Courses taken" chartType="line" [hideChart]="true" chartCaption="x" value="400" subtitle="Pairs" [loading]="loading()" />`,
})
class StatOnlyHostComponent {
  public readonly loading = signal(false);
}

const infoButton = (root: HTMLElement): HTMLButtonElement | null => root.querySelector('[data-testid="metric-card-info"]');
const tooltipText = (): string => document.body.querySelector('.p-tooltip')?.textContent?.trim() ?? '';

describe('MetricCardComponent info tooltip', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    TestBed.overrideComponent(MetricCardComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.querySelectorAll('.p-tooltip').forEach((node) => node.remove());
  });

  it('shows no info button without tooltip text', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    expect(infoButton(fixture.nativeElement)).toBeNull();
  });

  // Keyboard users reach the explanation by focusing the button, not only by hovering it.
  it('opens the explanation when the info button receives keyboard focus', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.info.set('Who is counted and over what range.');
    await fixture.whenStable();

    const button = infoButton(fixture.nativeElement);
    expect(button).not.toBeNull();
    expect(button?.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');

    button?.dispatchEvent(new FocusEvent('focus'));

    await vi.waitFor(() => expect(tooltipText()).toBe('Who is counted and over what range.'));
  });
});

describe('MetricCardComponent chart caption', () => {
  const caption = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-testid="metric-card-chart-caption"]');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    TestBed.overrideComponent(MetricCardComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('states the chart window under the chart when given one', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.caption.set('Per month, Nov 2025 – Oct 2026 to date');
    await fixture.whenStable();

    expect(caption(fixture.nativeElement)?.textContent?.trim()).toBe('Per month, Nov 2025 – Oct 2026 to date');
  });

  it('renders no caption without one', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();

    expect(caption(fixture.nativeElement)).toBeNull();
  });
});

describe('MetricCardComponent stat-only card', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatOnlyHostComponent] });
    TestBed.overrideComponent(MetricCardComponent, { remove: { imports: [ChartComponent] }, add: { imports: [ChartStubComponent] } });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders the value and subtitle without a chart area or caption', async () => {
    const fixture = TestBed.createComponent(StatOnlyHostComponent);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain('400');
    expect(root.textContent).toContain('Pairs');
    expect(root.querySelector('lfx-chart')).toBeNull();
    expect(root.querySelector('.h-16')).toBeNull();
    expect(root.querySelector('[data-testid="metric-card-chart-caption"]')).toBeNull();
  });

  it('shows no chart skeleton while loading', async () => {
    const fixture = TestBed.createComponent(StatOnlyHostComponent);
    fixture.componentInstance.loading.set(true);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.h-16')).toBeNull();
  });
});
