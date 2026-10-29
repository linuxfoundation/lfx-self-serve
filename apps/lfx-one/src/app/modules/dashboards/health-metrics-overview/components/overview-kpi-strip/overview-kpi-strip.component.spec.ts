// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverviewKpiStripComponent } from './overview-kpi-strip.component';

import type { HealthMetricsOverviewKpiView } from '@lfx-one/shared/interfaces';

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

  async function render(count: number): Promise<void> {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    await TestBed.configureTestingModule({ imports: [OverviewKpiStripComponent] }).compileComponents();
    fixture = TestBed.createComponent(OverviewKpiStripComponent);
    fixture.componentRef.setInput(
      'kpis',
      Array.from({ length: count }, (_, index) => kpi(`k${index}`))
    );
    fixture.componentRef.setInput('testId', 'strip');
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
});
