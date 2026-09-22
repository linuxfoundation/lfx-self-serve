// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_LINK } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EngagementSubNavComponent } from './engagement-sub-nav.component';

import type { HealthMetricsEngagementSubNavItem } from '@lfx-one/shared/interfaces';

const ITEMS: HealthMetricsEngagementSubNavItem[] = [
  { key: 'participation', label: 'Meeting participation', count: null, note: '' },
  { key: 'committees', label: 'Group attendance', count: 12, note: '2 dormant · 5 below 50%' },
  { key: 'orgs', label: 'Organization participation', count: 40, note: '' },
];

describe('EngagementSubNavComponent', () => {
  let fixture: ComponentFixture<EngagementSubNavComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EngagementSubNavComponent] }).compileComponents();

    fixture = TestBed.createComponent(EngagementSubNavComponent);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.componentRef.setInput('activeKey', 'committees');
    fixture.componentRef.setInput('topPx', 96);
    fixture.detectChanges();
  });

  it('renders one button per item plus the Members cross-link', () => {
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="engagement-sub-nav-"]:not([data-testid$="cross-link"])')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-cross-link"]').textContent.trim()).toBe(
      HEALTH_METRICS_ENGAGEMENT_SUB_NAV_CROSS_LINK
    );
  });

  it('shows a count and note only where the item carries them', () => {
    const committees = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    expect(committees.textContent).toContain('12');
    expect(committees.textContent).toContain('2 dormant · 5 below 50%');

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
