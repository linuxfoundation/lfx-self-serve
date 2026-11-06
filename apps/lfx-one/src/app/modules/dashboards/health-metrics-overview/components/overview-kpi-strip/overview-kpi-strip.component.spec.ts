// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverviewKpiStripComponent } from './overview-kpi-strip.component';

import type { HealthMetricsOverviewKpiStripVariant, HealthMetricsOverviewKpiView } from '@lfx-one/shared/interfaces';

const kpi = (key: string): HealthMetricsOverviewKpiView => ({ key, label: key, value: '1', delta: null, note: '' });

/** Captures the strip's observer so a test can report a width, as a real resize would. */
class FakeResizeObserver {
  public static latest: FakeResizeObserver;
  public constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.latest = this;
  }
  public observe(): void {
    /* no-op */
  }
  public disconnect(): void {
    /* no-op */
  }
  public resize(width: number): void {
    this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

describe('OverviewKpiStripComponent', () => {
  let fixture: ComponentFixture<OverviewKpiStripComponent>;

  async function render(items: number | HealthMetricsOverviewKpiView[], variant?: HealthMetricsOverviewKpiStripVariant): Promise<void> {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    await TestBed.configureTestingModule({ imports: [OverviewKpiStripComponent] }).compileComponents();
    fixture = TestBed.createComponent(OverviewKpiStripComponent);
    fixture.componentRef.setInput('kpis', typeof items === 'number' ? Array.from({ length: items }, (_, index) => kpi(`k${index}`)) : items);
    fixture.componentRef.setInput('testId', 'strip');
    if (variant) fixture.componentRef.setInput('variant', variant);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function resize(width: number): HTMLElement {
    FakeResizeObserver.latest.resize(width);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="strip"]');
  }

  function item(key: string): string {
    return fixture.nativeElement.querySelector(`[data-testid="strip-${key}"]`).className;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('keeps one ruled row while every item has room', async () => {
    await render(2);
    const strip = resize(400);

    expect(strip.getAttribute('data-layout')).toBe('row');
    expect(strip.style.gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))');
    expect(item('k1')).toContain('border-l');
  });

  it('stacks a narrow strip in one column, a top rule between items and no side dividers', async () => {
    await render(3);
    const strip = resize(400);

    expect(strip.getAttribute('data-layout')).toBe('stack');
    expect(strip.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(item('k1')).toContain('border-t');
    expect(item('k1')).not.toContain('border-l');
  });

  it('makes four items a 2 × 2 grid, the second column divided and the second row ruled', async () => {
    await render(4);
    const strip = resize(600);

    expect(strip.getAttribute('data-layout')).toBe('grid');
    expect(item('k1')).toContain('border-l');
    expect(item('k2')).not.toContain('border-l');
    expect(item('k2')).toContain('border-t');
    expect(item('k3')).toContain('border-l');
  });

  it.each(['card', 'section'] as const)('draws a %s change as the design does: an arrow and deeper shades on a card only', async (variant) => {
    await render([kpi('k0'), { ...kpi('k1'), delta: { label: '−14%', direction: 'down', good: false } }], variant);
    const delta: HTMLElement = fixture.nativeElement.querySelector('[data-testid="strip-k1-delta"]');

    expect(delta.textContent?.replace(/\s+/g, ' ').trim()).toBe('Down−14%');
    expect(delta.querySelector('i') !== null).toBe(variant === 'card');
    expect(delta.className).toContain(variant === 'card' ? 'text-red-700' : 'text-red-600');
    expect(item('k1')).toContain(variant === 'card' ? 'gap-[2px]' : 'gap-[8px]');
    expect(item('k1')).toContain(variant === 'card' ? 'pl-[20px]' : 'pl-[24px]');
  });
});
