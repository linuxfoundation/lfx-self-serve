// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { HealthMetricsBarListComponent } from './health-metrics-bar-list.component';

import type { HealthMetricsBarListRow } from '@lfx-one/shared/interfaces';

const ROWS: HealthMetricsBarListRow[] = [
  { key: 'gold', label: 'Gold', value: '65', pct: 100, tier: 'gold', icon: '', company: null },
  { key: 'startup', label: 'Startup', value: '64', pct: 98.5, tier: null, icon: 'fa-light fa-ticket', company: null },
  { key: 'acme', label: 'Acme Motors', value: '39 proposals', pct: 60, tier: null, icon: '', company: { kind: 'company', name: 'Acme Motors', logoUrl: '' } },
];

describe('HealthMetricsBarListComponent', () => {
  let fixture: ComponentFixture<HealthMetricsBarListComponent>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({ imports: [HealthMetricsBarListComponent] }).compileComponents();
    fixture = TestBed.createComponent(HealthMetricsBarListComponent);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('gridClass', 'grid-cols-[minmax(110px,150px)_1fr_40px]');
    fixture.componentRef.setInput('labelClass', 'font-medium');
    fixture.componentRef.setInput('testId', 'bars');
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function row(key: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="bars-row-${key}"]`);
  }

  it('lays each row out on the grid the widget sets, with its label, bar and value', async () => {
    await render();

    expect(row('gold')?.className).toContain('grid-cols-[minmax(110px,150px)_1fr_40px]');
    expect([...(row('gold')?.children ?? [])].map((cell) => cell.textContent?.trim())).toEqual(['Gold', '', '65']);
    expect((row('startup')?.querySelector('[aria-hidden="true"] span') as HTMLElement).style.width).toBe('98.5%');
    expect(row('gold')?.firstElementChild?.className).toContain('font-medium');
  });

  it('leads a tier with its icon, any other package with its icon, and a company with its logo box', async () => {
    await render();

    expect(row('gold')?.querySelector('lfx-health-metrics-tier-icon')).not.toBeNull();
    expect(row('startup')?.querySelector('.fa-ticket')).not.toBeNull();
    expect(row('acme')?.querySelector('lfx-ui-avatar')).not.toBeNull();
  });
});
