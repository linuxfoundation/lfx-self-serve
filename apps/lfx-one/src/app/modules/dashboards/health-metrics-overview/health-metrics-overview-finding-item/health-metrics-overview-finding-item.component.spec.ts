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

  it('budgets each group proportionally to its own total when the combined total exceeds the cap, instead of letting one group crowd out the rest', async () => {
    // Combined total (50) exceeds MAX_RENDERED_DOTS (20): a naive cap-per-group-then-slice would let
    // this fully-filled 40-total group alone fill all 20 rendered dots, silently dropping the second
    // group. Proportional budgeting gives it only 16 (40/50 share of 20), leaving 4 for the other group.
    await render({
      visual: {
        kind: 'dots',
        groups: [
          { label: 'A', filled: 40, total: 40 },
          { label: 'B', filled: 0, total: 10 },
        ],
      },
    });

    const dots = fixture.nativeElement.querySelectorAll('[data-testid="health-metrics-overview-finding-dots"] span[data-filled]');
    const filledDots = Array.from<Element>(dots).filter((dot) => dot.getAttribute('data-filled') === 'true');
    expect(dots.length).toBe(20);
    expect(filledDots.length).toBe(16);
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

  it('points the dots visual at its visible caption via aria-labelledby instead of duplicating the text', async () => {
    await render({ visual: { kind: 'dots', groups: [{ label: 'Renewals', filled: 1, total: 4 }], caption: 'Renewals' } });

    const dots: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-dots"]');
    const labelledBy = dots.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(dots.getAttribute('aria-label')).toBeNull();
    expect(fixture.nativeElement.querySelector(`#${labelledBy}`)?.textContent?.trim()).toBe('Renewals');
  });

  it('hides the dots visual from assistive tech when neither an authored caption nor a group label is available', async () => {
    // caption falls back to `groups[0].label`, so this branch is only reachable with an empty label — see
    // `initDotsVisual`'s `visual.caption ?? groups[0].label`.
    await render({ visual: { kind: 'dots', groups: [{ label: '', filled: 1, total: 4 }] } });

    const dots: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-dots"]');
    expect(dots.getAttribute('aria-hidden')).toBe('true');
    expect(dots.getAttribute('aria-labelledby')).toBeNull();
  });

  it('points the bar visual at its visible caption via aria-labelledby instead of duplicating the text', async () => {
    await render({ visual: { kind: 'bar', parts: [{ label: 'Healthy', value: 40, tone: 'act' }], caption: 'Healthy' } });

    const bar: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-bar"]');
    const labelledBy = bar.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(bar.getAttribute('aria-label')).toBeNull();
    expect(fixture.nativeElement.querySelector(`#${labelledBy}`)?.textContent?.trim()).toBe('Healthy');
  });

  it('falls back to a generic aria-label on the bar when it has no caption', async () => {
    await render({ visual: { kind: 'bar', parts: [{ label: 'Healthy', value: 40, tone: 'act' }] } });

    const bar: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-bar"]');
    expect(bar.getAttribute('aria-label')).toBe('Progress');
    expect(bar.getAttribute('aria-labelledby')).toBeNull();
  });
});
