// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsL2SubNavComponent } from './health-metrics-l2-sub-nav.component';

import type { HealthMetricsL2CrossReference, HealthMetricsL2SubNavItem } from '@lfx-one/shared/interfaces';

const CROSS_REFERENCE: HealthMetricsL2CrossReference = {
  text: 'Board & voting-member attendance is reported per member in',
  linkLabel: 'Members',
  route: 'members',
  fragment: 'board',
};
const ITEMS: HealthMetricsL2SubNavItem[] = [
  { key: 'participation', label: 'Meeting participation', count: null, note: '' },
  { key: 'committees', label: 'Group attendance', count: 12, note: '2 dormant' },
  { key: 'orgs', label: 'Organization participation', count: 40, note: '' },
];

describe('HealthMetricsL2SubNavComponent', () => {
  let fixture: ComponentFixture<HealthMetricsL2SubNavComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HealthMetricsL2SubNavComponent], providers: [provideRouter([])] }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsL2SubNavComponent);
    fixture.componentRef.setInput('items', ITEMS);
    fixture.componentRef.setInput('activeKey', 'committees');
    fixture.componentRef.setInput('topPx', 96);
    fixture.componentRef.setInput('ariaLabel', 'Engagement sections');
    fixture.componentRef.setInput('testIdPrefix', 'engagement');
    fixture.componentRef.setInput('crossReference', CROSS_REFERENCE);
    fixture.detectChanges();
  });

  it('renders one button per item plus the cross-reference note', () => {
    expect(fixture.nativeElement.querySelectorAll('button[data-testid^="engagement-sub-nav-"]')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-cross-reference-note"]').textContent.trim()).toBe(
      'Board & voting-member attendance is reported per member in Members'
    );
    expect(fixture.nativeElement.querySelector('nav').getAttribute('aria-label')).toBe('Engagement sections');
  });

  it('links the note to the target tab section, keeping the current query params', async () => {
    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-cross-reference-link"]');

    expect(link.textContent?.trim()).toBe('Members');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/members#board');
  });

  it('omits the cross-reference note when the tab has none', () => {
    fixture.componentRef.setInput('crossReference', null);
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

  it('highlights the active item as a pale blue block in semibold, with a hover background on the others', () => {
    const active = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees"]');
    const inactive = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs"]');

    expect(active.className).toContain('bg-blue-100');
    expect(active.className).toContain('font-semibold');
    expect(active.className).not.toContain('border-l');
    expect(inactive.className).toContain('text-gray-700');
    expect(inactive.className).toContain('hover:bg-gray-100');
    expect(inactive.className).not.toContain('font-semibold');
  });

  it('shows a count as a pill, blue on the active item, and a note after a red dot', () => {
    const activeCount = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees-count"]');
    const inactiveCount = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs-count"]');
    const note = fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-committees-note"]');

    expect(activeCount.textContent.trim()).toBe('12');
    expect(activeCount.className).toContain('bg-blue-200');
    expect(inactiveCount.className).toContain('bg-gray-100');
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-participation-count"]')).toBeNull();
    expect(note.textContent.trim()).toBe('2 dormant');
    expect(note.querySelector('.bg-red-500')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs-note"]')).toBeNull();
  });

  // The host is the grid item, so it is what sticks; a sticky child would have no room to travel in it.
  it('pins the rail at the offset the page measured, sticking the host and capping the list to the viewport', () => {
    const host = fixture.nativeElement as HTMLElement;
    const nav = host.querySelector('[data-testid="engagement-sub-nav"]') as HTMLElement;

    expect(host.style.top).toBe('96px');
    expect(host.classList).toContain('lg:sticky');
    expect(host.style.getPropertyValue('--l2-sub-nav-top')).toBe('96px');
    expect(nav.className).toContain('lg:overflow-y-auto');
    expect(nav.className).toContain('lg:max-h-[calc(100vh_-_var(--l2-sub-nav-top)_-_40px)]');
  });

  it('emits the picked section rather than scrolling itself', () => {
    const picked = vi.fn();
    fixture.componentInstance.sectionPicked.subscribe(picked);

    fixture.nativeElement.querySelector('[data-testid="engagement-sub-nav-orgs"]').click();

    expect(picked).toHaveBeenCalledWith('orgs');
  });
});
