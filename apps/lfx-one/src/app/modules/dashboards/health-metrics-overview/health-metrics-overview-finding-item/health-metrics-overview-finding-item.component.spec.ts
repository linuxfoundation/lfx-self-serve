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

  it('renders the sentence as plain text, matching the design (no inline bolding)', async () => {
    await render({ sentence: 'Lowest is TAG App Delivery at 29%.', emphasis: 'TAG App Delivery' });

    const paragraph = sentenceEl();
    expect(paragraph.textContent?.trim()).toBe('Lowest is TAG App Delivery at 29%.');
    expect(paragraph.querySelector('.font-bold')).toBeNull();
  });

  it('shows the keyLabel only when the finding has no visual', async () => {
    await render();

    expect(fixture.nativeElement.textContent).toContain('below 50%');
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

  it('flattens every dot group into one row with the first group as the trailing caption', async () => {
    await render({
      visual: {
        kind: 'dots',
        groups: [
          { label: 'At risk', filled: 2, total: 4 },
          { label: 'Healthy', filled: 3, total: 4 },
        ],
      },
    });

    const dots = fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-finding-dots"] span[data-filled]');
    expect(dots.length).toBe(8);
    expect(fixture.nativeElement.textContent).toContain('At risk');
  });

  it('renders a single fill sized to only the parts matching the finding classification, tinted with that tone', async () => {
    await render({
      classification: 'ok',
      visual: {
        kind: 'bar',
        parts: [
          { label: 'At risk', value: 65, tone: 'act' },
          { label: 'Healthy', value: 20, tone: 'ok' },
        ],
      },
    });

    const fill = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-bar"] > div');
    expect(fill.style.width).toBe('20%');
    expect(fill.classList.contains('bg-emerald-500')).toBe(true);
  });

  it('falls back to summing every part when none carry the finding classification tone', async () => {
    await render({
      classification: 'watch',
      visual: {
        kind: 'bar',
        parts: [
          { label: 'At risk', value: 65, tone: 'act' },
          { label: 'Healthy', value: 20, tone: 'ok' },
        ],
      },
    });

    const fill = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-bar"] > div');
    expect(fill.style.width).toBe('85%');
  });

  it('clamps the bar fill to 100% when the parts sum past it', async () => {
    await render({
      visual: {
        kind: 'bar',
        parts: [
          { label: 'A', value: 70, tone: 'act' },
          { label: 'B', value: 60, tone: 'act' },
        ],
      },
    });

    const fill = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-bar"] > div');
    expect(fill.style.width).toBe('100%');
  });

  it('positions the predicted range, point-prediction fill, and goal tick from low/high/pred/goal', async () => {
    await render({ visual: { kind: 'band', low: 55, high: 70, goal: 100, pred: 62 } });

    const band = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-band"]');
    const [range, pred, goal] = band.querySelectorAll(':scope > div');
    expect(range.style.left).toBe('55%');
    expect(range.style.width).toBe('15%');
    expect(pred.style.width).toBe('62%');
    expect(goal.style.left).toBe('100%');
  });

  it('renders one chip per tag', async () => {
    await render({ visual: { kind: 'tags', tags: ['Cloud', 'Fintech'] } });

    const chips = Array.from<HTMLElement>(fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-finding-tags"] span'));
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Cloud', 'Fintech']);
  });

  it('renders a link testid unique to the finding by sortRank', async () => {
    await render({ sortRank: 42, linkHref: 'https://pcc.lfx.dev/project/abc/reports/health-metrics/meetings#committees' });

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-link-42"]')).not.toBeNull();
  });
});
