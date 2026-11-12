// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsMetricsRowComponent } from './health-metrics-metrics-row.component';

import type { HealthMetricsMetricItem } from '@lfx-one/shared/interfaces';

const metric = (key: string, extra: Partial<HealthMetricsMetricItem> = {}): HealthMetricsMetricItem => ({
  key,
  label: `Label ${key}`,
  value: '1,024',
  ...extra,
});

describe('HealthMetricsMetricsRowComponent', () => {
  let fixture: ComponentFixture<HealthMetricsMetricsRowComponent>;

  const render = async (items: HealthMetricsMetricItem[]): Promise<void> => {
    fixture.componentRef.setInput('items', items);
    fixture.componentRef.setInput('testId', 'row');
    await fixture.whenStable();
  };
  const el = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const classes = (id: string): string => el(id)?.className ?? '';

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsMetricsRowComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsMetricsRowComponent);
  });

  it('lays out one ruled column per item, two per row on phones', async () => {
    await render([metric('a'), metric('b'), metric('c')]);
    const row = el('row') as HTMLElement;

    expect(row.style.getPropertyValue('--hm-metrics-cols')).toBe('3');
    expect(row.className).toContain('border-y');
    expect(row.className).toContain('max-[640px]:grid-cols-2');
  });

  it('divides every item after the first, and on phones divides the second of each pair, rules later rows and spans an odd last item', async () => {
    await render([metric('a'), metric('b'), metric('c')]);

    expect(classes('row-a')).toContain('pl-0');
    expect(el('row-a')?.classList.contains('border-l')).toBe(false);
    expect(classes('row-b')).toContain('border-l');
    expect(classes('row-b')).toContain('pl-[24px]');
    expect(classes('row-b')).toContain('max-[640px]:pl-[16px]');
    expect(classes('row-c')).toContain('max-[640px]:border-l-0');
    expect(classes('row-c')).toContain('max-[640px]:border-t');
    expect(classes('row-c')).toContain('max-[640px]:col-span-full');
    expect(classes('row-b')).not.toContain('col-span-full');
  });

  it('draws nothing for an empty list', async () => {
    await render([]);

    expect(el('row')).toBeNull();
  });

  it('spans the only item on phones', async () => {
    await render([metric('a')]);

    expect(classes('row-a')).toContain('max-[640px]:col-span-full');
    expect(classes('row-a')).toContain('pl-0');
  });

  it('does not span an even last item', async () => {
    await render([metric('a'), metric('b'), metric('c'), metric('d')]);

    expect(classes('row-d')).not.toContain('col-span-full');
    expect(classes('row-d')).toContain('max-[640px]:border-t');
  });

  it('shows the label and a light 34px value that drops to 28px on phones', async () => {
    await render([metric('a')]);

    expect(el('row-a-label')?.textContent?.trim()).toBe('Label a');
    expect(el('row-a-value')?.textContent?.trim()).toBe('1,024');
    expect(classes('row-a-value')).toContain('text-[34px]');
    expect(classes('row-a-value')).toContain('font-light');
    expect(classes('row-a-value')).toContain('max-[640px]:text-[28px]');
  });

  it('colours the trend by tone, defaulting to plain context, and leaves no trend line without one', async () => {
    await render([
      metric('up', { trend: '+12%', trendTone: 'up' }),
      metric('down', { trend: '−3 pp', trendTone: 'down' }),
      metric('flat', { trend: 'Not available', trendTone: 'flat' }),
      metric('plain', { trend: 'Across {N} events' }),
      metric('none'),
    ]);

    expect(el('row-up-trend')?.textContent?.trim()).toBe('+12%');
    expect(classes('row-up-trend')).toContain('text-emerald-600');
    expect(classes('row-down-trend')).toContain('text-red-600');
    expect(classes('row-flat-trend')).toContain('text-gray-400');
    expect(classes('row-plain-trend')).toContain('text-gray-500');
    expect(el('row-none-trend')).toBeNull();
  });

  it('adds the status dot and a focusable tip named by its text', async () => {
    await render([metric('a', { dotClass: 'bg-emerald-500', tip: 'How this is counted.' })]);
    const tip = el('row-a-tip') as HTMLElement;

    expect(el('row-a-label')?.querySelector('.bg-emerald-500')).not.toBeNull();
    expect(tip.getAttribute('tabindex')).toBe('0');
    expect(tip.getAttribute('aria-label')).toBe('How this is counted.');
    expect(tip.className).toContain('fa-circle-question');
  });

  it('shows a muted description with a coloured lead', async () => {
    await render([metric('a', { description: ' vs {Month}', descriptionLead: '+4%', descriptionLeadTone: 'up' })]);
    const description = el('row-a-description') as HTMLElement;

    expect(description.textContent?.replace(/\s+/g, ' ').trim()).toBe('+4% vs {Month}');
    expect(description.className).toContain('text-gray-400');
    expect(description.querySelector('.text-emerald-600')?.textContent).toBe('+4%');
  });

  it('draws the mini bar at its width with its caption', async () => {
    await render([metric('a', { bar: { pct: 40, fillClass: 'bg-blue-500', label: '{N} of {M}' } })]);
    const bar = el('row-a-bar') as HTMLElement;
    const fill = bar.querySelector('.bg-blue-500') as HTMLElement;

    expect(fill.style.width).toBe('40%');
    expect(bar.textContent?.trim()).toBe('{N} of {M}');
  });
});
