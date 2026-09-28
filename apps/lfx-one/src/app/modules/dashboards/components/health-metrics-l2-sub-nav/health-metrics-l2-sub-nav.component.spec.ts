// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsL2SubNavComponent } from './health-metrics-l2-sub-nav.component';

import type { HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

const NOTE = 'Board & voting-member attendance is reported per member in Members';
const ITEMS: HealthMetricsL2SubNavItem[] = [
  { key: 'participation', label: 'Meeting participation', count: null, note: '' },
  { key: 'committees', label: 'Group attendance', count: 12, note: '2 dormant' },
  { key: 'orgs', label: 'Organization participation', count: 40, note: '' },
];

describe('HealthMetricsL2SubNavComponent', () => {
  let fixture: ComponentFixture<HealthMetricsL2SubNavComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsL2SubNavComponent] }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsL2SubNavComponent);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.componentRef.setInput('activeKey', 'committees');
    fixture.componentRef.setInput('topPx', 96);
    fixture.componentRef.setInput('ariaLabel', 'Engagement sections');
    fixture.componentRef.setInput('testIdPrefix', 'engagement');
    fixture.componentRef.setInput('crossReferenceNote', NOTE);
    fixture.detectChanges();
  });

  it('renders one button per item plus the cross-reference note', () => {
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="engagement-sub-nav-"]:not([data-testid$="cross-reference-note"])')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-cross-reference-note"]').textContent.trim()).toBe(NOTE);
    expect(fixture.nativeElement.querySelector('nav').getAttribute('aria-label')).toBe('Engagement sections');
  });

  it('omits the cross-reference note when the tab has none', () => {
    fixture.componentRef.setInput('crossReferenceNote', '');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-cross-reference-note"]')).toBeNull();
  });

  it('shows a count and note only where the item carries them', () => {
    const committees = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    expect(committees.textContent).toContain('12');
    expect(committees.textContent).toContain('2 dormant');

    // A null count is an unresolved total, not a zero — the badge is omitted entirely.
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-participation"]').textContent).not.toContain('0');
  });

  it('marks exactly the active item as current', () => {
    const current = fixture.nativeElement.querySelectorAll('[aria-current="true"]');

    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('data-testid')).toBe('engagement-sub-nav-committees');
  });

  it('highlights the active item with type colour alone, not a block or edge indicator', () => {
    const active = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    const inactive = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs"]');

    expect(active.className).toContain('text-blue-600');
    expect(active.className).not.toMatch(/border-l|bg-blue/);
    expect(inactive.className).toContain('text-gray-600');
  });

  it('pins the rail at the offset the page measured', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav"]').style.top).toBe('96px');
  });

  it('emits the picked section rather than scrolling itself', () => {
    const picked = vi.fn();
    fixture.componentInstance.sectionPicked.subscribe(picked);

    fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs"]').click();

    expect(picked).toHaveBeenCalledWith('orgs');
  });
});
