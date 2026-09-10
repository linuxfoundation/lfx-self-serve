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
      sortRank: 10,
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

  function sentenceEl(): HTMLParagraphElement {
    return fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-sentence"]');
  }

  it('renders a plain sentence with no bold segment when there is no emphasis', async () => {
    await render();

    const paragraph = sentenceEl();
    expect(paragraph.textContent?.trim()).toBe('Plain sentence with no emphasis.');
    expect(paragraph.querySelector('.font-bold')).toBeNull();
  });

  it('renders the emphasis substring in bold and leaves the rest as plain text', async () => {
    await render({ sentence: 'Lowest is TAG App Delivery at 29%.', emphasis: 'TAG App Delivery' });

    const paragraph = sentenceEl();
    expect(paragraph.querySelector('.font-bold')?.textContent).toBe('TAG App Delivery');
    expect(paragraph.textContent?.trim()).toBe('Lowest is TAG App Delivery at 29%.');
  });

  it('falls back to plain text when the emphasis substring is not found in the sentence', async () => {
    await render({ sentence: 'Nothing matches here.', emphasis: 'missing' });

    const paragraph = sentenceEl();
    expect(paragraph.querySelector('.font-bold')).toBeNull();
    expect(paragraph.textContent?.trim()).toBe('Nothing matches here.');
  });

  it('caps rendered dots at 20 and clamps a non-zero filled count to at least one dot', async () => {
    await render({ visual: { kind: 'dots', groups: [{ label: 'Renewals', filled: 1, total: 60 }] } });

    const dots = fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-finding-dots"] span[data-filled]');
    const filledDots = Array.from<Element>(dots).filter((dot) => dot.getAttribute('data-filled') === 'true');
    expect(dots.length).toBe(20);
    expect(filledDots.length).toBe(1);
  });

  it('scales the filled count proportionally against the 20-dot cap', async () => {
    await render({ visual: { kind: 'dots', groups: [{ label: 'Renewals', filled: 5, total: 62 }] } });

    const dots = fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-finding-dots"] span[data-filled]');
    const filledDots = Array.from<Element>(dots).filter((dot) => dot.getAttribute('data-filled') === 'true');
    expect(dots.length).toBe(20);
    expect(filledDots.length).toBe(2);
  });

  it('renders zero filled dots for a zero-filled group', async () => {
    await render({ visual: { kind: 'dots', groups: [{ label: 'Renewals', filled: 0, total: 60 }] } });

    const dots = fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-finding-dots"] span[data-filled]');
    const filledDots = Array.from<Element>(dots).filter((dot) => dot.getAttribute('data-filled') === 'true');
    expect(dots.length).toBe(20);
    expect(filledDots.length).toBe(0);
  });

  it('omits a dot group with zero total instead of rendering it empty', async () => {
    await render({ visual: { kind: 'dots', groups: [{ label: 'Empty group', filled: 0, total: 0 }] } });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-dots"]')).toBeNull();
  });

  it('resolves each bar part to its classification tone', async () => {
    await render({
      visual: {
        kind: 'bar',
        parts: [
          { label: 'At risk', value: 65, tone: 'act' },
          { label: 'Healthy', value: 35, tone: 'ok' },
        ],
      },
    });

    const parts = fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-finding-bar"] > div');
    expect(parts[0].getAttribute('data-classification')).toBe('act');
    expect(parts[1].getAttribute('data-classification')).toBe('ok');
    expect(parts[0].classList.contains('bg-red-500')).toBe(true);
    expect(parts[1].classList.contains('bg-emerald-500')).toBe(true);
  });

  it('positions the band fill and goal marker from low/high/goal', async () => {
    await render({ visual: { kind: 'band', low: 55, high: 70, goal: 100 } });

    const [fill, marker] = fixture.nativeElement.querySelectorAll('.relative > div');
    expect(fill.style.left).toBe('55%');
    expect(fill.style.width).toBe('15%');
    expect(marker.style.left).toBe('100%');
  });

  it('renders one chip per tag', async () => {
    await render({ visual: { kind: 'tags', tags: ['Cloud', 'Fintech'] } });

    const chips = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('span')).filter((span) =>
      ['Cloud', 'Fintech'].includes(span.textContent?.trim() ?? '')
    );
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Cloud', 'Fintech']);
  });

  it('renders a link testid unique to the finding by sortRank', async () => {
    await render({ sortRank: 42, linkHref: 'https://pcc.lfx.dev/project/abc/reports/health-metrics/meetings#committees' });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-link-42"]')).not.toBeNull();
  });
});
