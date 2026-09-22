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

  it('scales to the series own range, so a tight run still shows its movement', async () => {
    const fixture = await render([0.54, 0.58, 0.59, 0.62]);

    const path = fixture.nativeElement.querySelector('[data-testid="engagement-sparkline"] path').getAttribute('d');
    // Lowest point sits on the baseline and the highest at the top — not four near-identical heights.
    expect(path).toContain('M0.0 18.0');
    expect(path).toContain('L60.0 0.0');
  });

  it('skips periods with no invited population rather than plotting them as zero', async () => {
    const fixture = await render([0.5, null, 0.5]);

    const path = fixture.nativeElement.querySelector('[data-testid="engagement-sparkline"] path').getAttribute('d');
    expect(path.split('L')).toHaveLength(2);
  });

  it('renders nothing but a placeholder below two points, which cannot express a direction', async () => {
    const fixture = await render([0.5, null, null]);

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sparkline"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sparkline-empty"]')).not.toBeNull();
  });
});
