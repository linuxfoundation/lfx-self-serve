// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersEngagementBadgeComponent } from './members-engagement-badge.component';

import type { HealthMetricsMembersDirectoryEngagementView } from '@lfx-one/shared/interfaces';

const ENGAGEMENT: HealthMetricsMembersDirectoryEngagementView = {
  label: 'Medium 5.4',
  badgeClass: 'bg-amber-50 text-amber-800',
  tip: {
    title: 'Medium engagement · 5.4',
    rows: [
      { label: 'Contribution', value: '12', color: null, separated: false },
      { label: 'Training', value: '—', color: null, separated: false },
      { label: 'Events', value: '3', color: null, separated: false },
      { label: 'Last engaged', value: 'Sep 14, 2026', color: null, separated: false },
    ],
  },
};

describe('MembersEngagementBadgeComponent', () => {
  let fixture: ComponentFixture<MembersEngagementBadgeComponent>;

  beforeEach(async () => {
    vi.useFakeTimers();
    await TestBed.configureTestingModule({ imports: [MembersEngagementBadgeComponent] }).compileComponents();
    fixture = TestBed.createComponent(MembersEngagementBadgeComponent);
    fixture.componentRef.setInput('engagement', ENGAGEMENT);
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  function badge(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="members-engagement-badge"]');
  }

  function tip(): HTMLElement | null {
    return document.querySelector('[data-testid="members-engagement-tip"]');
  }

  it('reads "{Level} {score}" in the level\'s tone, focusable and described by the popup\'s rows', () => {
    expect(badge().textContent?.trim()).toBe('Medium 5.4');
    expect(badge().className).toContain('bg-amber-50');
    expect(badge().getAttribute('tabindex')).toBe('0');
    const description = document.getElementById(badge().getAttribute('aria-describedby') ?? '');
    expect(description?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Medium engagement · 5.4. Contribution: 12. Training: —. Events: 3. Last engaged: Sep 14, 2026.'
    );
  });

  it('stays open while the pointer crosses onto the popup, and closes once it leaves both', () => {
    badge().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    badge().dispatchEvent(new MouseEvent('mouseleave'));
    tip()?.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(tip()).not.toBeNull();

    tip()?.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(tip()).toBeNull();
  });

  it('stays open for keyboard focus when the pointer leaves, and closes once focus moves on', () => {
    badge().dispatchEvent(new FocusEvent('focus'));
    badge().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    badge().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(tip()).not.toBeNull();

    badge().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(tip()).toBeNull();
  });

  it('closes on Escape pressed anywhere while the popup shows', () => {
    badge().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(tip()).toBeNull();
  });

  it('opens the chart-style popup on hover and focus, and closes it on leave, blur and Escape', () => {
    expect(tip()).toBeNull();

    badge().dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    expect(tip()?.querySelector('[data-testid="health-metrics-chart-tip-title"]')?.textContent?.trim()).toBe('Medium engagement · 5.4');
    expect(tip()?.querySelectorAll('[data-testid="health-metrics-chart-tip-row"]')).toHaveLength(4);

    badge().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(tip()).toBeNull();

    badge().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(tip()).not.toBeNull();

    badge().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(tip()).toBeNull();

    badge().dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    badge().dispatchEvent(new FocusEvent('blur'));
    fixture.detectChanges();
    expect(tip()).toBeNull();
  });
});
