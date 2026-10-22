// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { EngagementSparklineComponent } from './engagement-sparkline.component';

describe('EngagementSparklineComponent', () => {
  async function render(series: (number | null)[]): Promise<ComponentFixture<EngagementSparklineComponent>> {
    await TestBed.configureTestingModule({ imports: [EngagementSparklineComponent] }).compileComponents();

    const fixture = TestBed.createComponent(EngagementSparklineComponent);
    fixture.componentRef.setInput('series', series);
    fixture.detectChanges();
    return fixture;
  }

  function slots(fixture: ComponentFixture<EngagementSparklineComponent>): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid="engagement-sparkline"] > span'));
  }

  it('draws one bar per period, scaled to the series own range, bottom- and right-aligned', async () => {
    const fixture = await render([0.54, 0.58, 0.59, 0.62]);

    const chart = fixture.nativeElement.querySelector('[data-testid="engagement-sparkline"]') as HTMLElement;
    expect(chart.className).toContain('items-end');
    expect(chart.className).toContain('justify-end');
    expect(chart.className).toContain('h-[22px]');
    expect(chart.className).toContain('gap-[2px]');
    // Lowest on the 3px floor and highest at the 22px top — not four near-identical heights.
    expect(slots(fixture).map((slot) => slot.style.height)).toEqual(['3px', '12.5px', '14.9px', '22px']);
    expect(slots(fixture).every((slot) => slot.className.includes('w-[6px]'))).toBe(true);
  });

  it('draws the current period in the strong blue and the rest in the light one', async () => {
    const fixture = await render([0.4, 0.6, 0.8]);

    const [first, second, last] = slots(fixture);
    expect(first.className).toContain('bg-blue-200');
    expect(second.className).toContain('bg-blue-200');
    expect(last.className).toContain('bg-blue-500');
    expect(last.className).not.toContain('bg-blue-200');
  });

  it('keeps an unrated period as an empty slot of the same width, so later periods do not slide left', async () => {
    const fixture = await render([0.6, null, 0.5, 0.7]);

    const all = slots(fixture);
    expect(all).toHaveLength(4);
    expect(all[1].getAttribute('data-testid')).toBe('engagement-sparkline-gap');
    expect(all[1].className).toContain('w-[6px]');
    expect(all[1].style.height).toBe('');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="engagement-sparkline-bar"]')).toHaveLength(3);
  });

  it('highlights nothing when the current period is unrated', async () => {
    const fixture = await render([0.4, 0.8, null]);

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sparkline"] .bg-blue-500')).toBeNull();
    expect(slots(fixture)[2].getAttribute('data-testid')).toBe('engagement-sparkline-gap');
  });

  it('renders the em-dash placeholder below two rated periods, which cannot express a direction', async () => {
    const fixture = await render([0.5, null, null]);

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sparkline"]')).toBeNull();
    const placeholder = fixture.nativeElement.querySelector('[data-testid="engagement-sparkline-empty"]') as HTMLElement;
    expect(placeholder.textContent?.trim()).toBe('—');
    expect(placeholder.className).toContain('text-gray-400');
  });

  it('labels the chart for assistive technology', async () => {
    const fixture = await render([0.4, 0.8]);

    const chart = fixture.nativeElement.querySelector('[data-testid="engagement-sparkline"]') as HTMLElement;
    expect(chart.getAttribute('role')).toBe('img');
    expect(chart.getAttribute('aria-label')).toBe('Attendance history');
  });
});
