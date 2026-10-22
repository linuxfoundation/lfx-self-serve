// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsL2SubNavComponent } from './health-metrics-l2-sub-nav.component';

import type { HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

const ITEMS: HealthMetricsL2SubNavItem[] = [
  { key: 'participation', label: 'Meeting participation', count: null, note: '' },
  { key: 'committees', label: 'Group attendance', count: 12, note: '2 dormant' },
  { key: 'orgs', label: 'Organization participation', count: 40, note: '' },
];

describe('HealthMetricsL2SubNavComponent', () => {
  let fixture: ComponentFixture<HealthMetricsL2SubNavComponent>;
  let host: HTMLElement;

  function item(key: string): HTMLButtonElement {
    return host.querySelector(`[data-testid="engagement-sub-nav-${key}"]`) as HTMLButtonElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsL2SubNavComponent] }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsL2SubNavComponent);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.componentRef.setInput('activeKey', 'committees');
    fixture.componentRef.setInput('topPx', 96);
    fixture.componentRef.setInput('ariaLabel', 'Engagement sections');
    fixture.componentRef.setInput('testIdPrefix', 'engagement');
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
  });

  it('is a labelled navigation landmark with one button per item and one rail tick per item', () => {
    expect(host.getAttribute('role')).toBe('navigation');
    expect(host.getAttribute('aria-label')).toBe('Engagement sections');
    expect(host.getAttribute('data-testid')).toBe('engagement-sub-nav');
    expect(host.querySelectorAll('button[data-testid^="engagement-sub-nav-"]')).toHaveLength(3);
    expect(host.querySelectorAll('[data-testid="engagement-sub-nav-rail"] .hmn-tick')).toHaveLength(3);
  });

  it('marks exactly the active item as current, on its rail tick too', () => {
    const current = host.querySelectorAll('[aria-current="true"]');

    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('data-testid')).toBe('engagement-sub-nav-committees');
    const ticks = Array.from(host.querySelectorAll('.hmn-tick')).map((tick) => tick.classList.contains('hmn-tick-active'));
    expect(ticks).toEqual([false, true, false]);
  });

  // The design's `.hmn-item`: a blue bar on the left rule and a dark medium label; the rest stay grey and regular.
  it('lights the active item with a blue bar and a dark medium-weight label', () => {
    const activeLabel = item('committees').querySelector('.hmn-label') as HTMLElement;
    const inactiveLabel = item('orgs').querySelector('.hmn-label') as HTMLElement;

    expect(item('committees').className).toContain('border-blue-500');
    expect(activeLabel.className).toContain('text-gray-900');
    expect(activeLabel.firstElementChild?.className).toContain('font-medium');
    expect(item('orgs').className).toContain('border-transparent');
    expect(inactiveLabel.className).toContain('text-gray-500');
    expect(inactiveLabel.firstElementChild?.className).toContain('font-normal');
  });

  it('shows a count as an outlined pill and a note as a warning icon with a tooltip, only where the item has them', () => {
    const count = host.querySelector('[data-testid="engagement-sub-nav-committees-count"]') as HTMLElement;
    const note = host.querySelector('[data-testid="engagement-sub-nav-committees-note"]') as HTMLElement;
    const tooltip = note.querySelector('[role="tooltip"]') as HTMLElement;

    expect(count.textContent?.trim()).toBe('12');
    expect(count.className).toContain('border-gray-200');
    // A null count is an unresolved total, not a zero — the badge is omitted entirely.
    expect(host.querySelector('[data-testid="engagement-sub-nav-participation-count"]')).toBeNull();
    expect(note.querySelector('.fa-circle-exclamation')).not.toBeNull();
    expect(tooltip.textContent?.trim()).toBe('2 dormant');
    expect(item('committees').getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(host.querySelector('[data-testid="engagement-sub-nav-orgs-note"]')).toBeNull();
    expect(item('orgs').getAttribute('aria-describedby')).toBeNull();
  });

  it('pins at the offset the shell passes', () => {
    expect(host.style.top).toBe('96px');
  });

  it('emits the picked section rather than scrolling itself, then shuts the panel until the pointer leaves', () => {
    const picked = vi.fn();
    fixture.componentInstance.sectionPicked.subscribe(picked);

    item('orgs').click();
    fixture.detectChanges();

    expect(picked).toHaveBeenCalledWith('orgs');
    expect(host.classList).toContain('hmn-closed');

    host.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(host.classList).not.toContain('hmn-closed');
  });

  it('opens from a tap on the rail by focusing the current item, and Escape shuts it again', () => {
    (host.querySelector('[data-testid="engagement-sub-nav-rail"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(item('committees'));

    item('committees').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(host.classList).toContain('hmn-closed');
    expect(document.activeElement).not.toBe(item('committees'));
  });
});
