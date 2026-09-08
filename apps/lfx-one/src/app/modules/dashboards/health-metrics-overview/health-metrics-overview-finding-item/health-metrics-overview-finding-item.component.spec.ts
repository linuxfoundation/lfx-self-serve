// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { HealthMetricsOverviewFindingItemComponent } from './health-metrics-overview-finding-item.component';

import type { HealthMetricsOverviewFindingViewModel } from '@lfx-one/shared/interfaces';

describe('HealthMetricsOverviewFindingItemComponent', () => {
  let fixture: ComponentFixture<HealthMetricsOverviewFindingItemComponent>;

  function finding(overrides: Partial<HealthMetricsOverviewFindingViewModel> = {}): HealthMetricsOverviewFindingViewModel {
    return {
      classification: 'act',
      area: 'eng',
      areaLabel: 'Engagement',
      title: 'Some finding',
      sentence: 'Plain sentence with no emphasis.',
      keyValue: '8 of 31',
      keyLabel: 'below 50%',
      evaluatedAt: '2026-09-01',
      linkIsExternal: false,
      ...overrides,
    };
  }

  async function render(overrides: Partial<HealthMetricsOverviewFindingViewModel> = {}): Promise<void> {
    await TestBed.configureTestingModule({ imports: [HealthMetricsOverviewFindingItemComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsOverviewFindingItemComponent);
    fixture.componentRef.setInput('finding', finding(overrides));
    fixture.detectChanges();
  }

  it('renders a plain sentence with no bold segment when there is no emphasis', async () => {
    await render();

    const paragraph: HTMLParagraphElement = fixture.nativeElement.querySelectorAll('p')[1];
    expect(paragraph.textContent?.trim()).toBe('Plain sentence with no emphasis.');
    expect(paragraph.querySelector('b')).toBeNull();
  });

  it('renders the emphasis substring in bold and leaves the rest as plain text', async () => {
    await render({ sentence: 'Lowest is TAG App Delivery at 29%.', emphasis: 'TAG App Delivery' });

    const paragraph: HTMLParagraphElement = fixture.nativeElement.querySelectorAll('p')[1];
    expect(paragraph.querySelector('b')?.textContent).toBe('TAG App Delivery');
    expect(paragraph.textContent?.trim()).toBe('Lowest is TAG App Delivery at 29%.');
  });

  it('falls back to plain text when the emphasis substring is not found in the sentence', async () => {
    await render({ sentence: 'Nothing matches here.', emphasis: 'missing' });

    const paragraph: HTMLParagraphElement = fixture.nativeElement.querySelectorAll('p')[1];
    expect(paragraph.querySelector('b')).toBeNull();
    expect(paragraph.textContent?.trim()).toBe('Nothing matches here.');
  });

  it('clamps a non-zero filled count to at least one rendered dot', async () => {
    await render({ visual: { kind: 'dots', groups: [{ label: 'Renewals', filled: 1, total: 60 }] } });

    const dots = fixture.nativeElement.querySelectorAll('.flex.flex-wrap.gap-1 > span');
    const filledDots = Array.from<Element>(dots).filter((dot) => !dot.classList.contains('bg-gray-200'));
    expect(filledDots.length).toBeGreaterThanOrEqual(1);
  });

  it('omits a dot group with zero total instead of rendering it empty', async () => {
    await render({ visual: { kind: 'dots', groups: [{ label: 'Empty group', filled: 0, total: 0 }] } });

    expect(fixture.nativeElement.querySelector('.flex.flex-wrap.gap-1')).toBeNull();
  });

  it('resolves each bar part to a classification tone class', async () => {
    await render({
      visual: {
        kind: 'bar',
        parts: [
          { label: 'At risk', value: 65, tone: 'act' },
          { label: 'Healthy', value: 35, tone: 'ok' },
        ],
      },
    });

    const bars = fixture.nativeElement.querySelectorAll('.flex.h-2.w-full > div');
    expect(bars[0].classList).toContain('bg-red-500');
    expect(bars[1].classList).toContain('bg-emerald-500');
  });
});
