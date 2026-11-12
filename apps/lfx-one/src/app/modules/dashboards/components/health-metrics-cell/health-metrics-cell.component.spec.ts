// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsCellComponent } from './health-metrics-cell.component';

describe('HealthMetricsCellComponent', () => {
  let fixture: ComponentFixture<HealthMetricsCellComponent>;

  const query = (id: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  const set = async (inputs: Record<string, unknown>): Promise<void> => {
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsCellComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsCellComponent);
    await set({ text: 'Acme Motors' });
  });

  it('renders the text on one line, cut with an ellipsis, and no description by default', () => {
    expect(query('health-metrics-cell-text')?.textContent?.trim()).toBe('Acme Motors');
    expect(query('health-metrics-cell-text')?.className).toContain('truncate');
    expect(query('health-metrics-cell-description')).toBeNull();
  });

  it('greys out a dash', async () => {
    expect(query('health-metrics-cell-text')?.className).not.toContain('text-gray-400');

    await set({ text: '—' });

    expect(query('health-metrics-cell-text')?.className).toContain('text-gray-400');
  });

  it('puts a 12px neutral-500 description under the value, with its leading and trailing icons', async () => {
    await set({ description: 'Platinum · since 2021', descriptionIcon: 'fa-light fa-clock', descriptionEndIcon: 'fa-light fa-arrow-up-right' });

    const description = query('health-metrics-cell-description') as HTMLElement;
    for (const cls of ['text-[12px]', 'text-gray-500', 'truncate']) expect(description.className).toContain(cls);
    // Exactly the text, with no template space beside the icons.
    expect(description.textContent).toBe('Platinum · since 2021');
    const icons = Array.from(description.querySelectorAll('i')).map((icon) => icon.className);
    expect(icons[0]).toContain('fa-clock');
    expect(icons[0]).toContain('text-[11px]');
    expect(icons[1]).toContain('fa-arrow-up-right');
    expect(icons[1]).toContain('text-[10px]');
  });

  it('leads a tier name with its icon and a status with its dot', async () => {
    await set({ tier: 'gold', dotClass: 'bg-emerald-500' });

    expect(query('health-metrics-cell-tier')).not.toBeNull();
    expect(query('health-metrics-cell-dot')?.className).toContain('bg-emerald-500');
  });

  it('indents the text 38px after an icon tile and 42px after a person', async () => {
    await set({ lead: { kind: 'icon', icon: 'fa-light fa-ticket' } });
    expect(fixture.nativeElement.className).toContain('pl-[38px]');
    expect(query('health-metrics-cell-icon')?.querySelector('i')?.className).toContain('fa-ticket');

    await set({ lead: { kind: 'person', name: 'Jane Doe', photoUrl: '' } });
    expect(fixture.nativeElement.className).toContain('pl-[42px]');
    expect(query('health-metrics-cell-person')).not.toBeNull();
  });

  it('puts a company logo inline before the name and lines the description up under it', async () => {
    await set({ lead: { kind: 'company', name: 'Acme Motors', logoUrl: '' }, description: 'Member' });

    expect(fixture.nativeElement.className).not.toContain('pl-[');
    expect(query('health-metrics-cell-company')).not.toBeNull();
    expect(query('health-metrics-cell-description')?.className).toContain('pl-[32px]');
  });
});
